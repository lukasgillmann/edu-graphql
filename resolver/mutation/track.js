exports._editRouterTrack = async (sqlHistClient, userId, courseId, routerUrl) => {
  let query = `
      SELECT * FROM student_router_track
      WHERE student_id = ${userId}
    `;

  let res = await sqlHistClient.query(query);

  if (res && res.length) {
    // update that item
    res = res[0];

    if (res["url"] != routerUrl) {
      query = `
          UPDATE student_router_track
          SET url = '${routerUrl}'
          WHERE student_id = ${userId} AND course_id='${courseId}'
        `;
    } else {
      query = null;
    }
  } else {
    // Insert new one
    query = `
        INSERT INTO student_router_track (student_id, course_id, url) 
        VALUES (${userId}, '${courseId}', '${routerUrl}');
      `;
  }

  if (query) {
    res = await sqlHistClient.query(query);
  }
};
