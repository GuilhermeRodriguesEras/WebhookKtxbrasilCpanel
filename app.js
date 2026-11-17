require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: '-03:00',
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000,
});

// Executa uma query no banco.
// isSelect = true  → retorna array de linhas
// isSelect = false → retorna o ResultSetHeader completo (com insertId, affectedRows, etc.)
async function executarQuery(comando, params = [], isSelect = true) {
    const [result] = await pool.execute(comando, params);
    return isSelect ? result : result;
}

app.get('/', async(req, res) => {

    res.status(200).json({ live: 'true' });

});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/bancoConnectionHealth', async(req, res) => {
    try {
        const rows = await executarQuery('SELECT NOW() AS horario', [], true);
        res.json({
            status: 'connected',
            database_time: rows[0].horario,
        });
    } catch (error) {
        console.error('Erro ao verificar conexão com o banco de dados:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Não foi possível conectar ao banco de dados',
        });
    }
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
app.post('/api/login', async(req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Preencha usuário e senha.' });
    }

    try {
        const rows = await executarQuery(
            'SELECT id, username, password, permission FROM login WHERE username = ? LIMIT 1', [username.trim()],
            true
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
        }

        const user = rows[0];

        const hashBanco = Buffer.from(user.password.trim().toLowerCase(), 'utf8');
        const hashRecebida = Buffer.from(password.trim().toLowerCase(), 'utf8');

        const senhaValida =
            hashBanco.length === hashRecebida.length &&
            crypto.timingSafeEqual(hashBanco, hashRecebida);

        if (!senhaValida) {
            return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
        }

        const token = crypto.randomBytes(32).toString('hex');

        return res.status(200).json({
            token,
            username: user.username,
            permission: user.permission,
        });
    } catch (error) {
        console.error('Erro ao realizar login:', error.message);
        return res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

// ---------------------------------------------------------------------------
// Quote (orçamento)
// ---------------------------------------------------------------------------
app.post('/api/quote', async(req, res) => {
    const { nome, sobrenome, telefone, email, linhaDeInteresse, cpf_cnpj, mensagem } = req.body;

    if (!nome || !sobrenome || !telefone || !email || !linhaDeInteresse || !cpf_cnpj || !mensagem) {
        return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    }

    try {
        const result = await executarQuery(
            `INSERT INTO quote (nome, sobrenome, telefone, email, linhadeinteresse, cpf_cnpj, mensagem)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, [
                nome.trim().slice(0, 100),
                sobrenome.trim().slice(0, 100),
                telefone.trim().slice(0, 20),
                email.trim().slice(0, 100),
                linhaDeInteresse.trim().slice(0, 100),
                cpf_cnpj.trim().slice(0, 20),
                mensagem.trim(),
            ],
            false
        );

        return res.status(201).json({
            message: 'Orçamento enviado com sucesso!',
            id: result.insertId,
        });
    } catch (error) {
        console.error('Erro ao salvar orçamento:', error.message);
        return res.status(500).json({ error: 'Erro interno ao registrar solicitação.' });
    }
});

app.get('/api/quotes', async(req, res) => {
    try {
        const rows = await executarQuery(
            `SELECT id, nome, sobrenome, telefone, email, linhadeinteresse, cpf_cnpj, mensagem, created_at
             FROM quote
             ORDER BY created_at DESC`, [],
            true
        );
        return res.status(200).json(rows);
    } catch (error) {
        console.error('Erro ao buscar orçamentos:', error.message);
        return res.status(500).json({ error: 'Erro interno ao listar orçamentos.' });
    }
});

// ---------------------------------------------------------------------------
// Cloudinary upload helper
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });

function uploadToCloudinary(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: 'ktx_categorias' },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        );
        stream.end(buffer);
    });
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
app.get('/api/categories', async(req, res) => {
    try {
        // MariaDB não tem json_agg; usamos GROUP_CONCAT e reconstruímos o array.
        const rows = await executarQuery(
            `SELECT
                c.id,
                c.name,
                ci.image_url,
                GROUP_CONCAT(
                    CASE WHEN s.id IS NOT NULL
                         THEN CONCAT('{"id":', s.id, ',"name":"', REPLACE(s.name, '"', '\\"'), '"}')
                         ELSE NULL
                    END
                    ORDER BY s.name ASC
                    SEPARATOR ','
                ) AS subcategories_raw
             FROM category c
             LEFT JOIN category_image ci ON ci.category_id = c.id
             LEFT JOIN subcategory s ON s.category_id = c.id
             GROUP BY c.id, c.name, ci.image_url
             ORDER BY c.name ASC`, [],
            true
        );

        const categories = rows.map(row => ({
            ...row,
            subcategories: row.subcategories_raw ?
                JSON.parse('[' + row.subcategories_raw + ']') : [],
            subcategories_raw: undefined,
        }));

        return res.status(200).json(categories);
    } catch (error) {
        console.error('Erro ao listar categorias:', error.message);
        return res.status(500).json({ error: 'Erro ao listar categorias.' });
    }
});

app.post('/api/categories', upload.single('image'), async(req, res) => {
    const { name, imageUrlFallback } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'O nome da categoria é obrigatório.' });
    }

    try {
        const insertCat = await executarQuery(
            'INSERT INTO category (name) VALUES (?)', [name.trim()],
            false
        );
        const category = { id: insertCat.insertId, name: name.trim() };

        let finalImageUrl = imageUrlFallback ? imageUrlFallback.trim() : null;

        if (req.file) {
            finalImageUrl = await uploadToCloudinary(req.file.buffer);
        }

        if (finalImageUrl) {
            await executarQuery(
                'INSERT INTO category_image (category_id, image_url) VALUES (?, ?)', [category.id, finalImageUrl],
                false
            );
        }

        return res.status(201).json({
            ...category,
            image_url: finalImageUrl,
            subcategories: [],
        });
    } catch (error) {
        console.error('Erro ao criar categoria:', error.message);
        return res.status(500).json({ error: 'Erro ao cadastrar categoria.' });
    }
});

app.delete('/api/categories/:id', async(req, res) => {
    try {
        await executarQuery('DELETE FROM category WHERE id = ?', [Number(req.params.id)], false);
        return res.status(200).json({ message: 'Categoria removida.' });
    } catch (error) {
        console.error('Erro ao remover categoria:', error.message);
        return res.status(500).json({ error: 'Erro ao remover categoria.' });
    }
});

// ---------------------------------------------------------------------------
// Subcategorias
// ---------------------------------------------------------------------------
app.post('/api/subcategories', async(req, res) => {
    const { name, category_id } = req.body;

    if (!name || !name.trim() || !category_id) {
        return res.status(400).json({ error: 'Nome da subcategoria e categoria pai são obrigatórios.' });
    }

    try {
        const result = await executarQuery(
            'INSERT INTO subcategory (name, category_id) VALUES (?, ?)', [name.trim(), Number(category_id)],
            false
        );

        return res.status(201).json({
            id: result.insertId,
            name: name.trim(),
            category_id: Number(category_id),
        });
    } catch (error) {
        console.error('Erro ao criar subcategoria:', error.message);
        return res.status(500).json({ error: 'Erro ao cadastrar subcategoria.' });
    }
});

app.delete('/api/subcategories/:id', async(req, res) => {
    try {
        await executarQuery('DELETE FROM subcategory WHERE id = ?', [Number(req.params.id)], false);
        return res.status(200).json({ message: 'Subcategoria removida.' });
    } catch (error) {
        console.error('Erro ao remover subcategoria:', error.message);
        return res.status(500).json({ error: 'Erro ao remover subcategoria.' });
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));

module.exports = app;