exports._listCertificate = async (sqlHistClient, userId, page, pageSize) => {
  const query = `
    SELECT A.id, A.course_id, B.display_name, A.module_title, A.total, A.created, B.course_image_url, B.duration, B.objective, DATE_FORMAT(C.start, '%Y-%m-%dT%TZ') AS start, 
    DATE_FORMAT(C.end, '%Y-%m-%dT%TZ') AS end
    FROM (
      SELECT id, course_id, course_title, module_title, is_final, created, total
      FROM student_certificate
      WHERE user_id = ${userId} AND is_final=1
      LIMIT ${page * pageSize}, ${pageSize}
    ) A
      LEFT JOIN course_overviews_courseoverview B ON A.course_id = B.id
      LEFT JOIN student_courseenrollment C ON A.course_id = C.course_id AND user_id=${userId};
    SELECT COUNT(*) AS total FROM student_certificate WHERE user_id = ${userId} AND is_final=1;
  `;

  let res = await sqlHistClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  res = res.map((v) => ({ ...v, objective: v.objective.split("\n") }));

  return { total, page, page_size: pageSize, data: res };
};
