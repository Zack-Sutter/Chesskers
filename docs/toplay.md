## server setup

$env:ENGINE_BINARY_PATH="C:\Users\zxsut\Documents\GitHub\chesskers\engine\target\release\chesskers-engine.exe"
$env:MODEL_PATH="C:\Users\zxsut\Documents\GitHub\chesskers\engine\models\v001.onnx"
npm run dev -w chesskers-server # Fastify + WS on http://localhost:3001

## frontend setup

npm run dev
