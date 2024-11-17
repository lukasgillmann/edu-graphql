exports._termsGet = async (sqlHistClient) => {
  const query = `
    SELECT content, enabled, created, updated
    FROM terms
  `;
  const res = await sqlHistClient.query(query);
  return res.length ? res[0] : {};
};
