const { _toSQLTime, _getCurrentDate } = require("../common/time");
const { _getSQLAppClient, DEFAULT_OUTPUT } = require("../common/utility");

exports._getIsLicenseAvailable = async (sqlAppClient, isLicense = true) => {
  const currDate = _toSQLTime(_getCurrentDate());

  let query = "",
    res = "";

  query = `
    SELECT id, type
    FROM license_plan
    WHERE status='current' AND start <= '${currDate}' AND end > '${currDate}'
  `;

  res = await sqlAppClient.query(query);

  const license = res.find((v) => v.type == 1);
  const credit = res.find((v) => v.type == 2 || v.type == 3);

  if (isLicense && !license) return false;
  if (!isLicense && !credit) return false;

  return true;
};

exports._getAvailableLicenseNumber = async (sqlAppClient) => {
  const obj = { license_available: 0, credit_available: 0, license_total: 0, credit_total: 0, license_disabled: 0, credit_disabled: 0 };

  let query = "",
    res = "";
  const currDate = _toSQLTime(_getCurrentDate());

  query = `
    SELECT type, start, end, quantity
    FROM license_plan
    WHERE status='current' AND start <= '${currDate}' AND end > '${currDate}';
  `;

  res = await sqlAppClient.query(query);

  const license = res.find((v) => v.type == 1);
  // const credit = res.find(v => v.type == 2 || v.type == 3);

  if (license) {
    const startDate = _toSQLTime(_getCurrentDate(license.start));
    const endDate = _toSQLTime(_getCurrentDate(license.end));
    const currDate = _toSQLTime(_getCurrentDate());

    query = `
      SELECT COUNT(*) AS active_count
      FROM student_courseenrollment
      WHERE (start >= '${startDate}' AND start < '${endDate}') OR (end >= '${startDate}' AND end < '${endDate}') OR (start < '${startDate}' AND end > '${endDate}');

      SELECT COUNT(*) AS inactive_count
      FROM student_courseenrollment
      WHERE is_active=0 OR end < '${currDate}';
    `;
    res = await sqlAppClient.query(query);

    obj.license_total = license.quantity;
    obj.license_available = license.quantity - res[0][0].active_count;
    obj.license_disabled = res[1][0].inactive_count;
  }

  return obj;
};

exports._licenseList = async (sqlAppClient, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  const currDate = _toSQLTime(_getCurrentDate());
  const query = `
    SELECT 
      A.id,
      A.is_active, 
      A.start, 
      A.end, 
      B.display_name, 
      B.short_description, 
      B.course_image_url,
      C.username,
      C.first_name,
      C.last_name,
      C.email,
      IF(A.end > '${currDate}', 1, 0) as is_available
    FROM student_courseenrollment A
      LEFT JOIN course_overviews_courseoverview B ON A.course_id = B.id
      LEFT JOIN auth_user C ON A.user_id = C.id
    LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total FROM student_courseenrollment;
  `;

  let res = await sqlAppClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  // If the state is active, but if the date is expired, we set it as inactive
  for (let i = 0; i < res.length; i++) {
    if (res[i].is_active && !res[i].is_available) {
      res[i].is_active = false;
    }
  }

  return { total, page, page_size: pageSize, data: res };
};

exports.licenseList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { page_size, page } = obj;

  const sqlAppClient = await _getSQLAppClient();
  try {
    return await this._licenseList(sqlAppClient, page, page_size);
  } catch (e) {
    console.log("[license list error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};
