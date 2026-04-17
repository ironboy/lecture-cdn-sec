import path from 'path';
import express from 'express';

const port = 5797;

const app = express();

app.use(express.static('www'));

app.get('/*splat', async (req, res) => {
  res.sendFile(path.join(import.meta.dirname, 'www', 'index.html'));
});

app.listen(port, () => console.log(`Listening on http://localhost:${port}`));