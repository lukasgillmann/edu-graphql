const { _getMongoLogClient } = require("../common/utility");

/**
{
  user_id,
  course_id,
  data: [
    {
      date,
      device,
      ip_address,
      browser
    }
  ]
}
*/
exports.editLoginHist = async (userId, ip, device, browser) => {
  const currTime = new Date().getTime();

  const mongoClient = await _getMongoLogClient();

  try {
    // Determine whether there is document inside MongoDB
    let res = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.login_hist")
      .aggregate([{ $match: { user_id: userId } }, { $project: { _id: "$_id" } }])
      .toArray();

    if (!res || res.length == 0) {
      // If there is no document for this user-course pair, then insert new one
      await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.login_hist")
        .insertOne({
          user_id: userId,
          data: [
            {
              date: currTime,
              device: device,
              ip_address: ip,
              browser: browser,
            },
          ],
        });
    } else {
      // If there is item
      const objectId = res[0]["_id"];

      await mongoClient
        .db(process.env.MONGO_DB_INSPECT_NAME)
        .collection("inspect.login_hist")
        .updateOne(
          { _id: objectId },
          {
            $push: {
              data: {
                $each: [
                  {
                    date: currTime,
                    device: device,
                    ip_address: ip,
                    browser: browser,
                  },
                ],
                $position: 0,
              },
            },
          }
        );
    }

    return true;
  } catch (e) {
    console.log("[login hist edit err]", e);
    return false;
  } finally {
    mongoClient.close();
  }
};
