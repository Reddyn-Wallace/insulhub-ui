const https = require('https');
const data = JSON.stringify({
  query: "query { __typename }"
});
const options = {
  hostname: 'api.insulhub.nz',
  path: '/graphql',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
};
const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    console.log('RESULT:' + body);
    process.exit(0);
  });
});
req.write(data);
req.end();
