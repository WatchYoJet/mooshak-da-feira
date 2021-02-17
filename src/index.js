const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { enqueue, unqueue, getQueueSize } = require('./queue');
const { startContainer, getNewVolume } = require('./docker');
const Stream = require('stream');

const parseTests = (profiles, tests) =>
  tests.map((v) => ({ ...v, profile: profiles[v.profile] })).filter((v) => !!v.profile);

const mooshakDaFeira = ({ profiles = {}, tests = [], port = process.env.PORT || 5000 } = {}) => {
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server);

  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.use(express.static(path.join(__dirname, 'static')));

  const parsedTests = parseTests(profiles, tests);

  io.on('connection', handleSocket(parsedTests));

  server.listen(port);
  console.log(`Listening on port ${port}.`);
};

const handleSocket = (tests) => (socket) => {
  socket.on('submit', (code) => {
    socket.emit('clear');
    runTests(tests, socket, code);
  });
};

const runTests = (tests, socket, code) => {
  const start = async () => {
    socket.emit('result', '[Mooshak da Feira] Spinning up test environment...\n\n');

    // Create a shared volume for all tests
    const volume = await getNewVolume();

    // Use a standard for loop to run one test at a time
    for (test of tests) await runTest(test, code, socket, volume);
    socket.emit('result', `\n[Mooshak da Feira] Finished executing tests\n`);
    socket.emit('done');
    await volume.remove();
  };

  enqueue(socket.id, start);
};

const runTest = async (test, code, socket, dockerVolume) => {
  test = {
    ...test,
    stdin: test.stdin.replace('%mooshak_da_feira_code%', code),
    files: Object.keys(test.files).reduce((acc, key) => {
      acc[key] = test.files[key].replace('%mooshak_da_feira_code%', code);
      return acc;
    }, {}),
  };

  const writableStream = new Stream.Writable();
  writableStream._write = (chunk, encoding, next) => {
    socket.emit('result', chunk.toString());
    next();
  };
  return await startContainer(test, writableStream, dockerVolume);
};

module.exports = mooshakDaFeira;
