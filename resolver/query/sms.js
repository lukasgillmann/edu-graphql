const AWS = require("aws-sdk");
const { _getMongoLogClient, _getSQLAppClient } = require("../common/utility");
const { _insertSMSLog } = require("../mutation/sms");

const AWS_SNS = new AWS.SNS({
  apiVersion: "2010-03-31",
  accessKeyId: "",
  secretAccessKey: "",
  region: "eu-west-3",
});

AWS_SNS.setSMSAttributes({
  attributes: { DefaultSMSType: "Transactional" },
});

exports.sendSMS = async (type, phone, message) => {
  const params = {
    Message: message,
    MessageStructure: "string",
    PhoneNumber: phone,
  };

  console.log("[sending message]", params);
  await _insertSMSLog(type, phone);
  return AWS_SNS.publish(params).promise();
};

exports._smsLogList = async (mongoHistClient, page, pageSize) => {
  let logs = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("sms.log")
    .aggregate([
      { $sort: { time: -1 } },
      {
        $facet: {
          data: [{ $skip: pageSize * page }, { $limit: pageSize }],
          metadata: [{ $count: "total" }],
        },
      },
      {
        $project: {
          total: { $arrayElemAt: ["$metadata.total", 0] },
          data: 1,
        },
      },
    ])
    .toArray();

  logs = {
    total: 0,
    page: page,
    page_size: pageSize,
    data: [],
    ...(logs.length ? logs[0] : {}),
  };

  return logs;
};

exports.smsLogList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;

  const mongoClient = await _getMongoLogClient();

  try {
    return await this._smsLogList(mongoClient, page, page_size);
  } catch (e) {
    console.log("[err]", e);

    return null;
  } finally {
    await mongoClient.close();
  }
};

exports._smsTemplateList = async (sqlHistClient) => {
  let query = `
    SELECT id, type, content, variable, enabled,
      DATE_FORMAT(created, '%Y-%m-%dT%TZ') AS created, 
      DATE_FORMAT(updated, '%Y-%m-%dT%TZ') AS updated
    FROM sms_template
    WHERE enabled=${true};
  `;

  let templates = await sqlHistClient.query(query);
  templates = templates.map((v) => ({ ...v, variable: JSON.parse(v.variable) }));
  return templates;
};

exports.smsTemplateList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();
  try {
    return await this._smsTemplateList(sqlAppClient, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.sendTestSMS = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { phone, message } = obj;
  await this.sendSMS("test", phone, message);
  return true;
};
