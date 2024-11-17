exports._getRouterTrack = async (sqlHistClient, userId) => {
  const query = `
    SELECT url, course_id
    FROM student_router_track
    WHERE student_id = ${userId}
  `;

  return await sqlHistClient.query(query);
};
