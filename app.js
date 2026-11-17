const express = require('express');
const app = express();
const PORT = 3000;

// Rota GET na raiz que retorna apenas o status 200 (OK)
app.get('/', (req, res) => {
    res.sendStatus(200);
});

// Rota alternativa que retorna status 200 com um JSON de confirmação
app.get('/teste', (req, res) => {
    res.status(200).json({ status: 'OK', mensagem: 'Servidor funcionando!' });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});