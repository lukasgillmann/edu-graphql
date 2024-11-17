exports._editViewed = async (sqlHistClient, userId, courseId, routePath) => {
  let query = `
      SELECT user_id, vertical_ids FROM student_verticals_viewed
      WHERE user_id = ${userId} AND course_id = '${courseId}'
    `;

  let res = await sqlHistClient.query(query);

  if (res && res.length) {
    // update that item
    res = JSON.parse(res[0]["vertical_ids"]);
    res = [...new Set([...res, routePath])];

    res = res.filter((item, pos) => res.indexOf(item) == pos);

    query = `
      UPDATE student_verticals_viewed
      SET vertical_ids = '${JSON.stringify(res)}'
      WHERE user_id = ${userId} AND course_id = '${courseId}'
    `;
  } else {
    // Insert new one
    query = `
      INSERT INTO student_verticals_viewed (user_id, course_id, vertical_ids) 
      VALUES (${userId}, '${courseId}', '${JSON.stringify([routePath])}');
    `;
  }

  res = await sqlHistClient.query(query);
};
