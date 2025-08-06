const { createHandler } = require('@app-core/server');
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
const { default: axios } = require('axios');
const querystring = require('querystring');

// a class for reqline
class ReqLine {
  constructor(reqline) {
    this.reqline = reqline;
    this.method = null;
    this.headers = null;
    this.query = {};
    this.body = {};
    this.full_url = null;
  }

  // Helper function to validate and parse JSON strings
  parseJsonSafely(jsonString, section) {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      throwAppError(`Invalid JSON format in ${section} section`, ERROR_CODE.APPERR);
    }
  }

  buildQueryString(params) {
    return querystring.stringify(params);
  }

  parseReqline() {
    if (!this.reqline || typeof this.reqline !== 'string') {
      throwAppError('Reqline must be a string', ERROR_CODE.INVLDDATA);
    }
    const parts = this.reqline.split(' | ');

    if (parts.length < 2) {
      throwAppError('Missing required HTTP or URL keyword', ERROR_CODE.INVLDDATA);
    }

    // http part
    const httpPart = parts[0];
    if (!httpPart.startsWith('HTTP ')) {
      throwAppError('Missing HTTP keyword');
    }

    this.method = httpPart.substring(5).trim();
    const allowedMethods = ['GET', 'POST'];
    if (!allowedMethods.includes(this.method)) {
      throwAppError(
        `Invalid HTTP method, only ${allowedMethods.join(', ')} are allowed `,
        ERROR_CODE.INVLDDATA
      );
    }
    // validate url section
    const urlPart = parts[1];
    if (!urlPart.startsWith('URL ')) {
      throwAppError('Missing required URL keyword', ERROR_CODE.INVLDDATA);
    }

    this.url = urlPart.substring(4).trim();
    if (!this.url) {
      throwAppError('URL value cannot be empty', ERROR_CODE.INVLDDATA);
    }

    // Process optional parts

    for (let i = 2; i < parts.length; i++) {
      const part = parts[i];
      const spaceIndex = part.indexOf(' ');

      if (spaceIndex === -1) {
        throwAppError('Missing space after keyword', ERROR_CODE.INVLDDATA);
      }

      const keyword = part.substring(0, spaceIndex);
      const value = part.substring(spaceIndex + 1).trim();
      const allowedKeywords = ['HEADERS', 'QUERY', 'BODY'];
      if (!allowedKeywords.includes(keyword)) {
        throwAppError(
          `Invalid keyword: ${keyword}. Only ${allowedKeywords.join(', ')} are allowed`,
          ERROR_CODE.INVLDDATA
        );
      }

      if (keyword === 'HEADERS') {
        this.headers = this.parseJsonSafely(value, 'HEADERS');
      } else if (keyword === 'QUERY') {
        this.query = this.parseJsonSafely(value, 'QUERY');
      } else if (keyword === 'BODY') {
        this.body = this.parseJsonSafely(value, 'BODY');
      }
    }

    // Build full URL with query parameters
    this.full_url = this.url;
    if (Object.keys(this.query).length > 0) {
      this.full_url += `?${this.buildQueryString(this.query)}`;
    }

    return this;
  }

  async execute() {
    const startTime = performance.now();
    const startTimestamp = Date.now();

    let response;
    try {
      if (this.method === 'GET') {
        response = await axios.get(this.full_url, {
          headers: this.headers,
        });
      } else {
        response = await axios.post(this.full_url, this.body, {
          headers: this.headers,
        });
      }
    } catch (error) {
      if (error.response) {
        response = error.response;
      } else {
        throwAppError(`Request failed: ${error.message}`, ERROR_CODE.APPERR);
      }
    }

    const endTime = performance.now();
    const endTimestamp = Date.now();

    return {
      response,
      timing: {
        duration: Math.round(endTime - startTime),
        startTimestamp,
        endTimestamp,
      },
    };
  }
}

module.exports = createHandler({
  method: 'post',
  path: '/reqline',
  middlewares: [],
  async handler(rc, helpers) {
    try {
      if (!rc?.body?.reqline) {
        throwAppError(`Missing reqline in request body`, ERROR_CODE.INVLDDATA);
      }

      const reqline = new ReqLine(rc.body.reqline);
      reqline.parseReqline(); // parse it to set all properties
      const { response, timing } = await reqline.execute();
      return {
        status: helpers.http_statuses.HTTP_200_OK,
        data: {
          request: {
            query: reqline.query,
            body: reqline.body,
            headers: reqline.headers,
            full_url: reqline.full_url,
          },
          response: {
            http_status: response.status,
            duration: timing.duration,
            request_start_timestamp: timing.startTimestamp,
            request_stop_timestamp: timing.endTimestamp,
            response_data: response.data,
          },
        },
      };
    } catch (error) {
      // res.statusCode = 400;
      return {
        status: helpers.http_statuses.HTTP_400_BAD_REQUEST,
        data: {
          error: true,
          message: error.message,
        },
      };
    }
  },
});
