const axios = require("axios");
const { _parseENV, _getSQLAppClient, DEFAULT_OUTPUT, _getMongoLogClient } = require("../common/utility");
const { _listCourse } = require("./course");
const { _listMeeting } = require("./meet_event");
const { _getAvailableLicenseNumber, _licenseList } = require("./license");
const { _listPhysicalSession } = require("./physical_session");
const { _userGet, _userList } = require("./user");
const { _listDevS3Object, _getDevS3Object } = require("../common/aws");

const BLOCK_LIST = ["doctonet"];
const V2_YOGA_LIST = ["fact", "internal", "doctonet", "ouiformation"];

const _listMasterPlatform = async (jwt) => {
  let data = [];

  data = await _listDevS3Object(process.env.REACT_APP_S3_DEV_BUCKET_NAME);
  data = data
    .filter((v) => v.Size)
    .map((v) => {
      const splits = v.Key.split(".");
      const siteName = splits.length >= 2 ? splits[splits.length - 2] : "";
      const firstSplit = splits.length > 1 ? splits[0] : null;
      const environ = firstSplit == "dev/" ? "Development" : firstSplit == "prod/" ? "Production" : "Test";

      return {
        site_name: siteName,
        path: v.Key,
        env: environ,
        updated: new Date(v.LastModified).toISOString(),
      };
    });

  data = data.map((v) => ({
    ...v,
    endpoint: v.env === "Production" && !BLOCK_LIST.includes(v.site_name) ? `https://${v.site_name}.cloudplateforme.com/v2-api` : null,
  }));

  const allPromise = data
    .filter((v) => v.endpoint)
    .map((v) =>
      axios.post(
        v.endpoint,
        JSON.stringify({
          query: `
            query master_platform_status_get {
              master_platform_status_get {
                site_name
                user_total
                course_total
                virtual_total
                physical_total
                license_total
                license_available
                license_disabled
              }
            }
          `,
          variables: {},
        }),
        {
          headers: {
            Authorization: jwt,
            "Content-Type": V2_YOGA_LIST.includes(v.site_name) ? "application/graphql" : "application/json",
          },
        }
      )
    );

  let values = [];
  try {
    values = await Promise.all(allPromise);
  } catch (e) {
    console.log("err]", e);
    console.log("[error]", e.response && e.response.data);
    values = [];
  }

  values = values.map((v) => (v.data && v.data.data && v.data.data.master_platform_status_get ? v.data.data.master_platform_status_get : {}));
  for (let i = 0; i < data.length; i++) {
    const item = values.find((v) => v.site_name === data[i].site_name) || {};
    data[i] = {
      ...data[i],
      user_total: item.user_total || 0,
      course_total: item.course_total || 0,
      virtual_total: item.virtual_total || 0,
      physical_total: item.physical_total || 0,
      license_total: item.license_total || 0,
      license_available: item.license_available || 0,
      license_disabled: item.license_disabled || 0,
    };
  }

  return data;
};

exports.masterDashboardGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN"].indexOf(permission) < 0) return [];

  const { jwt } = obj;

  const data = {
    user: {},
    platforms: [],
  };

  const sqlAppClient = _getSQLAppClient();

  try {
    const proUserGet = _userGet(sqlAppClient, userId, permission);
    const proPlatforms = _listMasterPlatform(jwt);

    data.user = await proUserGet;
    data.platforms = await proPlatforms;

    return data;
  } catch (e) {
    console.log("[master error]", e);
    return data;
  } finally {
    sqlAppClient.quit();
  }
};

exports.masterPlatformList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN"].indexOf(permission) < 0) return [];

  const { jwt } = obj;

  return await _listMasterPlatform(jwt);
};

exports.masterPlatformGet = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN"].indexOf(permission) < 0) return {};

  const { path } = obj;

  let data = "";

  try {
    data = await _getDevS3Object(process.env.REACT_APP_S3_DEV_BUCKET_NAME, path);
    const obj = _parseENV(data);

    data = obj["REACT_APP_BASE_URL"].split(".");
    const baseDomain = `${data[data.length - 2]}.${data[data.length - 1]}`;

    return {
      site_name: obj["REACT_APP_SITE_NAME"],
      site_display_name: obj["REACT_APP_SITE_DISPLAY_NAME"],
      admin_email: obj["REACT_APP_CONTACT_EMAIL"],
      base_domain: baseDomain,
      gql_version: Number(obj["GRAPHQL_SERVICES_BUILD_ID"]) || 12,
    };
  } catch (e) {
    console.log("[admin inspect error]", e);
    return {};
  }
};

exports.masterPlatformStatusGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN"].indexOf(permission) < 0) return [];

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    site_name: process.env.REACT_APP_SITE_NAME,
    user_total: 0,
    course_total: 0,
    virtual_total: 0,
    physical_total: 0,
    license_total: 0,
    license_available: 0,
    license_disabled: 0,
  };

  try {
    const proUserList = _userList(sqlAppClient, mongoHistClient, userId, permission, 0, DEFAULT_OUTPUT.page_size);
    const proListCourse = _listCourse(sqlAppClient, userId, 0, DEFAULT_OUTPUT.page_size);
    const proListMeeting = _listMeeting(sqlAppClient, userId, 0, DEFAULT_OUTPUT.page_size);
    const proPhysicalSessionList = _listPhysicalSession(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proLicenseList = _licenseList(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proLicense = _getAvailableLicenseNumber(sqlAppClient);

    data.user_total = (await proUserList).total;
    data.course_total = (await proListCourse).total;
    data.virtual_total = (await proListMeeting).total;
    data.physical_total = (await proPhysicalSessionList).total;
    data.license_total = (await proLicenseList).total;

    const { license_total, license_available, license_disabled } = await proLicense;

    data.license_total = license_total;
    data.license_available = license_available;
    data.license_disabled = license_disabled;

    return data;
  } catch (e) {
    console.log("[master get error]", e);
    return data;
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};
