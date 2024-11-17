const { DEFAULT_OUTPUT } = require("../common/utility");

exports._getReview = async (sqlAppClient, userId, courseId = "", verticalId = "") => {
  let query = " WHERE ";
  query += userId ? `user_id=${userId} AND ` : "";
  query += courseId ? `course_id='${courseId}' AND ` : "";
  query += verticalId ? `vertical_id='${verticalId}' AND ` : "";
  query = query.slice(0, -4);

  query =
    `
    SELECT type, content, section_title, sequence_title, vertical_title
    FROM student_review
  ` + query;

  const res = await sqlAppClient.query(query);
  return res.length ? res[0] : {};
};

exports._listReview = async (sqlAppClient, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  let query = `
    SELECT A.*, TRIM(CONCAT(B.first_name, ' ', B.last_name)) AS author_fullname, 
      B.username AS author_name, A.user_id AS author_id, C.avatar, C.cover,
      IF(B.is_superuser = 1, 'SUPERADMIN', IF(B.is_staff = 1, 'STAFF', IF(E.state = 'granted', 'ADMIN', 'USER'))) AS permission
    FROM (
      SELECT id, user_id, course_id, type, content, section_title, sequence_title, vertical_title,    
        DATE_FORMAT(created, '%Y-%m-%dT%TZ') AS created
      FROM student_review
      ORDER BY id DESC
      LIMIT ${page * pageSize}, ${pageSize}
    ) AS A
      LEFT JOIN auth_user B ON A.user_id = B.id
      LEFT JOIN auth_userprofile C ON A.user_id = C.user_id
      LEFT JOIN course_overviews_courseoverview D ON A.course_id = D.id
      LEFT JOIN course_creators_coursecreator E ON A.user_id = E.user_id;
    SELECT COUNT(*) AS total FROM student_review;
  `;

  let reviews = await sqlAppClient.query(query);
  const total = reviews[1][0].total;
  reviews = reviews[0];

  return { total, page, page_size: pageSize, data: reviews };
};
