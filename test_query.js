const fetch = require('node-fetch');

async function test() {
  const query = `
    query Jobs($stages: [JobStage!], $leadStatus: String) {
      jobs(stages: $stages, leadStatus: $leadStatus) {
        total
      }
    }
  `;
  
  const token = ""; // I don't have a token here.
  
  const res = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { stages: ["QUOTE"], leadStatus: "DEAD" }
    })
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}
test();
