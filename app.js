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
    host: '177.53.141.112',
    user: 'ktxbrasil_admin',
    password: 'FLYYKo&L=q7Fh4vv',
    database: 'ktxbrasil_Site',
    timezone: '-03:00',
    port: 3307,
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));

module.exports = app;