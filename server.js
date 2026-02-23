// package.json + server.js webhook only
const express = require('express');
app.post('/webhook/mews', (req,res)=> res.sendStatus(200));
