const { _toSQLTime, _getNextNMonthDate } = require("../common/time");
const { _getSQLAppClient, _fillHTMLTemplate } = require("../common/utility");
const { sendEmail } = require("../query/email");

// type: LICENSE: 1, CREDIT_BUSINESS: 2, CREDIT_PRO: 3
exports._addLicense = async (sqlAppClient, type, quantity, price, annual = true) => {
  let query = "",
    res = "";
  const currDate = new Date();
  const typeString = type == 1 ? `type=1` : `(type=2 OR type=3)`;

  // Get remaining calculated license number
  const currSQLDate = _toSQLTime(currDate);
  query = `
    SELECT id, FLOOR(unit_price * quantity * DATEDIFF(end, '${currSQLDate}') / DATEDIFF(end, start) / ${price}) AS count
    FROM license_plan
    WHERE status='current' AND ${typeString};
  `;
  res = await sqlAppClient.query(query);
  const totalLicenseNumber = res.length ? res[0].count + quantity : quantity;

  const startDate = _toSQLTime(_getNextNMonthDate(currDate, 0));
  const endDate = _toSQLTime(_getNextNMonthDate(currDate, annual ? 12 : 1));

  query = `
    UPDATE license_plan SET status='disabled' WHERE ${typeString} AND status='current';
    INSERT INTO license_plan (type, start, end, unit_price, quantity, annual, status)
    VALUES ('${type}', '${startDate}', '${endDate}', ${price}, ${totalLicenseNumber}, ${annual}, 'current');
  `;

  await sqlAppClient.query(query);

  // Now send email ************************************************************************************************
  query = `SELECT subject, content FROM email_template WHERE type='license_add' AND enabled=1 AND end_user='admin'`;
  res = await sqlAppClient.query(query);
  const adminHtml = res && res.length ? res[0].content : null;
  const subject = res && res.length ? res[0].subject : "";

  if (adminHtml) {
    const values = {
      PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
      LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
      CURRENT_DATE: new Date().toISOString(),
      LICENSE_NUMBER: totalLicenseNumber,
      START_DATE: startDate,
      END_DATE: endDate,
    };
    await sendEmail("license_add", process.env.REACT_APP_CONTACT_EMAIL, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(adminHtml, values));
  }
  // Email End ************************************************************************************************

  return true;
};

// Superadmin can add license
exports.addLicense = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN"].indexOf(permission) < 0) return false;

  const { type, quantity, price, annual } = obj;

  const sqlAppClient = await _getSQLAppClient();

  try {
    await this._addLicense(sqlAppClient, type, quantity, price, annual);
    return true;
  } catch (e) {
    console.log("[delete err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports._updateLicenseStatus = async (sqlAppClient) => {
  console.log("[****** CRON ******* [Update License Status]");

  const today = _toSQLTime(new Date());

  let res = await sqlAppClient.query(`
    UPDATE license_plan 
    SET status='disabled' 
    WHERE status='current' AND end < '${today}';
  `);

  console.log("[update license status]", res);
};

exports.deleteLicense = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { license_id } = obj;
  const sqlAppClient = await _getSQLAppClient();

  try {
    await sqlAppClient.query(`DELETE FROM student_courseenrollment WHERE id=${license_id}`);
    return true;
  } catch (e) {
    console.log("[delete err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
