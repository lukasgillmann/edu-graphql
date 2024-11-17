const Pusher = require("pusher");
const pusher = new Pusher({
  appId: process.env.REACT_APP_PUSHER_API_ID,
  key: process.env.REACT_APP_PUSHER_KEY,
  secret: process.env.REACT_APP_PUSHER_SECRET,
  cluster: process.env.REACT_APP_PUSHER_CLUSTER,
  useTLS: true,
});
exports.sendPusherData = async (channel, event, data) => {
  await pusher.trigger(channel, event, data);
};
