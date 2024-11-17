const { _getSQLAppClient, DEFAULT_OUTPUT } = require("../common/utility");

exports._categoryList = async (sqlAppClient, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  let query = `
    SELECT A.id, A.name, A.admin_editable, DATE_FORMAT(A.created, '%Y-%m-%dT%TZ') AS created, B.course_id AS course_id, C.display_name, C.short_description, C.course_image_url AS course_image_url, DATE_FORMAT(C.created, '%Y-%m-%dT%TZ') AS course_created
    FROM (
      SELECT *
      FROM category_overview
      LIMIT ${Number(pageSize) * Number(page)}, ${Number(pageSize)}
    ) AS A
      LEFT JOIN category_course B ON A.id = B.category_id
      LEFT JOIN course_overviews_courseoverview C ON C.id = B.course_id
    ORDER BY A.id;
    SELECT COUNT(*) AS total FROM category_overview;
  `;
  let res = await sqlAppClient.query(query);

  const total = res[1][0].total;
  res = res[0];

  const data = [];
  let currId = null;
  for (let item of res) {
    if (currId !== item.id) {
      data.push({
        ...item,
        courses: item.course_id
          ? [
              {
                id: item.course_id,
                display_name: item.display_name,
                short_description: item.short_description,
                course_image_url: item.course_image_url,
                created: item.course_created,
              },
            ]
          : [],
      });
      currId = item.id;
    } else if (item.course_id) {
      data[data.length - 1].courses.push({
        id: item.course_id,
        display_name: item.display_name,
        short_description: item.short_description,
        course_image_url: item.course_image_url,
        created: item.course_created,
      });
    }
  }

  return {
    total: total,
    page: page,
    page_size: pageSize,
    data: data,
  };
};

exports.categoryList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;

  const client = _getSQLAppClient();

  try {
    return await this._categoryList(client, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    client.quit();
  }
};
