const { _getMongoLogClient } = require("../common/utility");

exports._listUserLastLogin = async (mongoHistClient) => {
  let hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.login_hist")
    .aggregate([
      {
        $project: {
          _id: 0,
          user_id: 1,
          last_login: { $arrayElemAt: ["$data.date", 0] },
        },
      },
    ])
    .toArray();

  return hists;
};

exports._listLoginHist = async (mongoHistClient, userId, page, pageSize) => {
  const filterBody = [
    { $match: { user_id: userId } },
    { $unwind: "$data" },
    {
      $project: {
        date: "$data.date",
        device: "$data.device",
        ip_address: "$data.ip_address",
        browser: "$data.browser",
      },
    },
  ];

  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.login_hist")
    .aggregate([...filterBody, { $skip: pageSize * page }, { $limit: pageSize }])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.login_hist")
    .aggregate([...filterBody, { $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let hists = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: dbData,
  };

  return hists;
};

exports.listLoginHist = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;

  const mongoClient = await _getMongoLogClient();
  try {
    return await this._listLoginHist(mongoClient, userId, page, page_size);
  } catch (e) {
    console.log("[login inspect list error]", e);
    return null;
  } finally {
    mongoClient.close();
  }
};
