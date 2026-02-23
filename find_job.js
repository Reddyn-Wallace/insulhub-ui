async function findJob() {
  const query = `
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
  `;

  const res = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TOKEN || ""}`,
    },
    body: JSON.stringify({
      query,
      variables: { _id: "699177c3a5185b0a06c01f07" },
    }),
  });

  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

findJob().catch(console.error);
