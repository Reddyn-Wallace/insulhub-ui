async function testQuery() {
  const query = `
    query Jobs($stages: [JobStage!], $leadStatus: String) {
      jobs(stages: $stages, leadStatus: $leadStatus) {
        total
      }
    }
  `;

  const res = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.TOKEN ? { Authorization: `Bearer ${process.env.TOKEN}` } : {}),
    },
    body: JSON.stringify({
      query,
      variables: { stages: ["QUOTE"], leadStatus: "DEAD" },
    }),
  });

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

testQuery().catch(console.error);
