exports._listViewed = async (sqlHistClient, userId, courseId) => {
  let query = `
    SELECT vertical_ids
    FROM student_verticals_viewed
    WHERE user_id = ${userId} AND course_id = '${courseId}'
  `;

  let res = await sqlHistClient.query(query);

  if (res.length) {
    return JSON.parse(res[0].vertical_ids);
  }
  return [];
};
