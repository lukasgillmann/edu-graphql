const { _getSQLAppClient, _getMongoLogClient, _getMongoAppClient, DEFAULT_OUTPUT, _jsonReplacer } = require("../common/utility");
const { _editRouterTrack } = require("../mutation/track");
const { _editViewed } = require("../mutation/viewed");
const { _categoryList } = require("./category");
const { _listCertificate } = require("./certificate");
const { _getCertificateVariable } = require("./certificate_variable");
const { _listUserTimeChart } = require("./chart");
const { _listComment, _getCommentsNumber } = require("./comment");
const { _listCourse, _getCourseStructure, _getDownloads } = require("./course");
const { _listMeetingInspect } = require("./meet_inspect");
const { _listMeetingUpcoming, _listMeetingRecording, _listMeeting } = require("./meet_event");
const { _getUserGroupList } = require("./group");
const { _listLoginHist } = require("./login_hist");
const { _getChatEnableFlag } = require("./message");
const { _listInspectModule } = require("./module_inspect");
const { _listNotification } = require("./notification");
const { _listReplayInspect } = require("./replay_inspect");
const { _getReview } = require("./review");
const { _termsGet } = require("./terms");
const { _themeList } = require("./theme");
const { _getRouterTrack } = require("./track");
const { _userGet, _getAdminInfo } = require("./user");
const { _listViewed } = require("./viewed");
const { _getInspectVimeo } = require("./vimeo_inspect");
const { _listXBlock } = require("./xblock");
const { _toIsoString } = require("../common/time");

exports.appDashboardGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;
  if (!userId) return {};

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    comment_recent_list: [],
    user_get: {},
    course_list: [],
    router_track_get: [],
    category_list: [],
    certificate_list: [],
    term_get: {},
    user_login_log_list: {},
    certificate_variable_get: {},
    theme_list: [],
    admin_info: {},
    meet_event_list: [],
  };

  try {
    const currDate = new Date();
    currDate.setHours(currDate.getHours() - 1);
    const startTime = _toIsoString(currDate);

    const proGetUser = _userGet(sqlAppClient, userId, permission);
    const proListCourse = _listCourse(sqlAppClient, userId, 0, 100);
    const proGetRouterTrack = _getRouterTrack(sqlAppClient, userId);
    const proListCategory = _categoryList(sqlAppClient);
    const proListCertificate = _listCertificate(sqlAppClient, userId, 0, 100);
    const proGetTerm = _termsGet(sqlAppClient);
    const proListLoginHist = _listLoginHist(mongoHistClient, userId, 0, DEFAULT_OUTPUT.page_size);
    const proGetCertificateVariable = _getCertificateVariable(sqlAppClient);
    const proListTheme = _themeList(sqlAppClient);
    const proGetAdminInfo = _getAdminInfo(sqlAppClient);
    const proGetChatEnableFlag = _getChatEnableFlag(sqlAppClient);
    const proGetCommentCount = _getCommentsNumber(mongoHistClient, userId);
    const proGroups = _getUserGroupList(sqlAppClient, userId);
    const proNotification = _listNotification(sqlAppClient, mongoHistClient, userId);
    const proListMeeting = _listMeeting(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);

    data.user_get = await proGetUser;
    data.course_list = await proListCourse;
    data.router_track_get = await proGetRouterTrack;
    data.category_list = await proListCategory;
    data.certificate_list = await proListCertificate;
    data.term_get = await proGetTerm;
    data.user_login_log_list = await proListLoginHist;
    data.certificate_variable_get = await proGetCertificateVariable;
    data.theme_list = await proListTheme;
    data.admin_info = await proGetAdminInfo;
    data.chat_enabled = await proGetChatEnableFlag;
    data.comment_count = await proGetCommentCount;
    data.user_groups = await proGroups;
    data.notification_list = await proNotification;
    data.meet_event_list = await proListMeeting;

    // If the userId is not exist in our db
    if (!data.user_get || !data.user_get.id) return {};

    return JSON.stringify(data, _jsonReplacer);
  } catch (e) {
    console.log("[app dashboard error]", e);
    return JSON.stringify(data, _jsonReplacer);
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports.appCourseDetailGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { course_id } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoAppClient = await _getMongoAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    course_structure_get: {},
    comment_list: DEFAULT_OUTPUT,
    meeting_upcoming_list: [],
    meet_recording_list: DEFAULT_OUTPUT,
    viewed_list: [],
    get_downloads: {},
    inspect_module_list: DEFAULT_OUTPUT,
    inspect_replay_list: DEFAULT_OUTPUT,
    inspect_meeting_list: DEFAULT_OUTPUT,
    user_chart: { total_module_spent: 0, total_quiz_spent: 0, total_virtual_spent: 0, total_replay_spent: 0, data: [] },
  };

  try {
    const currTime = new Date().getTime();
    const day = 1000 * 60 * 60 * 24;

    const proCourseStructure = _getCourseStructure(sqlAppClient, mongoAppClient, course_id);
    const proListComment = _listComment(sqlAppClient, mongoHistClient, course_id, "", 0, DEFAULT_OUTPUT.page_size);
    // const proListUpcomingSession = _listUpcomingSession(sqlAppClient, null, course_id, 0, DEFAULT_OUTPUT.page_size);
    const proListMeetingUpcoming = _listMeetingUpcoming(sqlAppClient, userId, 0, DEFAULT_OUTPUT.page_size);
    const proListMeetingRecording = _listMeetingRecording(sqlAppClient, course_id, 0, DEFAULT_OUTPUT.page_size);
    const proListViewed = _listViewed(sqlAppClient, userId, course_id);
    const proGetDownloads = _getDownloads(mongoAppClient, course_id);
    const proListModuleInspect = _listInspectModule(mongoHistClient, userId, course_id, 0, DEFAULT_OUTPUT.page_size);
    const proListReplayInspect = _listReplayInspect(mongoHistClient, userId, course_id, 0, DEFAULT_OUTPUT.page_size);
    const proListMeetingInspect = _listMeetingInspect(mongoHistClient, userId, course_id, 0, DEFAULT_OUTPUT.page_size);
    const proUserChart = _listUserTimeChart(mongoHistClient, userId, currTime - 7 * day, currTime);

    data.course_structure_get = await proCourseStructure;
    data.comment_list = await proListComment;
    data.meeting_upcoming_list = await proListMeetingUpcoming;
    data.meet_recording_list = await proListMeetingRecording;
    data.viewed_list = await proListViewed;
    data.get_downloads = await proGetDownloads;
    data.inspect_module_list = await proListModuleInspect;
    data.inspect_replay_list = await proListReplayInspect;
    data.inspect_meeting_list = await proListMeetingInspect;
    data.user_chart = await proUserChart;

    return JSON.stringify(data, _jsonReplacer);
  } catch (e) {
    console.log("[app course detail error]", e);
    return JSON.stringify(data, _jsonReplacer);
  } finally {
    sqlAppClient.quit();
    mongoAppClient.close();
    mongoHistClient.close();
  }
};

exports.appCourseUnitGet = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { course_id, vertical_id, discussion_id, vimeo_id, definition_ids = [], router_url } = obj.input;

  const sqlAppClient = _getSQLAppClient();
  const mongoAppClient = await _getMongoAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    xblock_list: [],
    comment_list: DEFAULT_OUTPUT,
    review_get: {},
    inspect_vimeo_get: {},
  };

  try {
    if (definition_ids.length) data.xblock_list = await _listXBlock(mongoAppClient, definition_ids);
    if (discussion_id) data.comment_list = await _listComment(sqlAppClient, mongoHistClient, course_id, discussion_id, 0, 10);
    data.review_get = await _getReview(sqlAppClient, userId, course_id, vertical_id);
    if (vimeo_id) data.inspect_vimeo_get = await _getInspectVimeo(mongoHistClient, userId, course_id, vimeo_id);

    if (!is_ghost) {
      await _editRouterTrack(sqlAppClient, userId, course_id, router_url);
      await _editViewed(sqlAppClient, userId, course_id, router_url);
    }

    return JSON.stringify(data, _jsonReplacer);
  } catch (e) {
    console.log("[app unit get error]", e);
    return JSON.stringify(data, _jsonReplacer);
  } finally {
    sqlAppClient.quit();
    mongoAppClient.close();
    mongoHistClient.close();
  }
};
