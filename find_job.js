const https = require('https');

const data = JSON.stringify({
  query: `
    query Job($_id: ObjectId!) {
      job(_id: $_id) {
        _id
        jobNumber
        stage
        archivedAt
        lead {
          leadStatus
        }
      }
    }
  `,
  variables: { _id: "699177c3a5185b0a06c01f07" }
});

const options = {
  hostname: 'api.insulhub.nz',
  path: '/graphql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Authorization': 'Bearer ' + process.env.TOKEN // I need a token
  }
};
