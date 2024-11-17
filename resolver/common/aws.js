var AWS = require("aws-sdk");

const prodS3 = new AWS.S3({
  accessKeyId: process.env.REACT_APP_S3_ACCESS_KEY,
  secretAccessKey: process.env.REACT_APP_S3_SECRET_KEY,
  signatureVersion: "v4",
});

const devS3 = new AWS.S3({
  accessKeyId: process.env.REACT_APP_S3_DEV_ACCESS_KEY,
  secretAccessKey: process.env.REACT_APP_S3_DEV_SECRET_KEY,
  signatureVersion: "v4",
});

exports._listDevS3Object = (bucket) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
    };
    devS3.listObjectsV2(params, function (err, data) {
      if (err) {
        console.log("[s3 list error]", err);
        reject([]);
      } else {
        resolve(data.Contents || []);
      }
    });
  });
};

exports._getDevS3Object = (bucket, path) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
      Key: path,
    };
    devS3.getObject(params, function (err, data) {
      if (err) {
        console.log("[s3 get error]", err);
        reject("");
      } else {
        resolve(data.Body.toString());
      }
    });
  });
};

exports._upload2DevS3 = (bucket, path, content) => {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(content);
    const data = {
      Bucket: bucket,
      Key: path,
      Body: buf,
      ContentEncoding: "utf-8",
      ContentType: "text/plain",
    };
    devS3.upload(data, function (err, res) {
      if (err) {
        console.log("[upload error]", err);
        reject(err);
      } else {
        console.log("[upload success]");
        resolve(res);
      }
    });
  });
};

exports._uploadString2ProdS3 = (directory, content) => {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(content);
    const data = {
      Bucket: process.env.REACT_APP_S3_BUCKET_NAME,
      Key: directory + "/theme.css",
      Body: buf,
      ContentEncoding: "utf-8",
      ContentType: "text/css",
      ACL: "public-read",
    };
    prodS3.upload(data, function (err, res) {
      if (err) {
        console.log("[upload error]", err);
        reject(err);
      } else {
        console.log("[upload success]");
        resolve(res);
      }
    });
  });
};
