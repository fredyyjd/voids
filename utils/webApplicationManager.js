const http = require('http');
const crypto = require('crypto');

const {
  buildApplicationEmbed,
  buildDecisionRow,
  updateApplicationRefs,
} = require('./applicationManager');

function safeString(value, max = 1000) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

function makeApiKeyValid(providedKey) {
  const expectedKey = process.env.APPLICATIONS_API_KEY;

  if (!expectedKey || !providedKey) {
    return false;
  }

  const provided = Buffer.from(String(providedKey));
  const expected = Buffer.from(String(expectedKey));

  if (provided.length !== expected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  const output = JSON.stringify(data);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(output),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-application-key',
  });

  res.end(output);
}

async function getReviewChannel(client, config) {
  const channelId = config.websiteApplicationChannelId;

  if (!channelId) {
    return null;
  }

  const channel = await client.channels
    .fetch(channelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) {
    return null;
  }

  return channel;
}

async function handleApplication(client, config, body) {
  const userId = safeString(body.userId, 30);
  const applicationId = safeString(body.applicationId, 100);

  if (!userId) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'Discord user ID is required.',
      },
    };
  }

  if (!applicationId) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'Application ID is required.',
      },
    };
  }

  if (!/^\d{15,25}$/.test(userId)) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'Invalid Discord user ID.',
      },
    };
  }

  const applicationConfig = (
    config.applications || []
  ).find(
    (application) =>
      String(application.id) === String(applicationId)
  );

  if (!applicationConfig) {
    return {
      status: 404,
      data: {
        success: false,
        error: 'Application type not found.',
      },
    };
  }

  const channel = await getReviewChannel(client, config);

  if (!channel) {
    return {
      status: 500,
      data: {
        success: false,
        error:
          'Application review channel could not be found.',
      },
    };
  }

  const answers = Array.isArray(body.answers)
    ? body.answers
    : [];

  // Same look and the same five buttons as applications sent from Discord.
  const user = await client.users.fetch(userId).catch(() => null);

  if (!user) {
    return {
      status: 404,
      data: {
        success: false,
        error: 'Discord user not found.',
      },
    };
  }

  const member = await channel.guild?.members.fetch(userId).catch(() => null);

  const embed = buildApplicationEmbed(member, applicationConfig, answers, user);

  const message = await channel.send({
    embeds: [embed],
    components: [buildDecisionRow(userId, applicationId)],
  });

  // Remembered so Accept / Deny can update this post and "Open ticket with user" works.
  updateApplicationRefs(userId, applicationId, {
    guildId: channel.guild?.id,
    logChannelId: channel.id,
    logMessageId: message.id,
    answers: answers.map((a) => String(a?.answer ?? a ?? '')),
  });

  console.log(
    `[WEB APPLICATION] ${
      applicationConfig.label || applicationId
    } submitted by ${userId}. Message: ${message.id}`
  );

  return {
    status: 200,
    data: {
      success: true,
      messageId: message.id,
    },
  };
}

function startWebApplicationServer(client, config) {
  const port = Number(process.env.PORT) || 3000;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods':
            'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':
            'Content-Type, x-application-key',
        });

        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/') {
        return sendJson(res, 200, {
          online: true,
          bot: client.user
            ? client.user.tag
            : 'starting',
          service: 'Void’s Cove application API',
        });
      }

      if (
        req.method === 'POST' &&
        req.url === '/api/applications'
      ) {
        const apiKey =
          req.headers['x-application-key'];

        if (!makeApiKeyValid(apiKey)) {
          return sendJson(res, 401, {
            success: false,
            error: 'Invalid API key.',
          });
        }

        let body;

        try {
          body = await readRequestBody(req);
        } catch (error) {
          return sendJson(res, 400, {
            success: false,
            error:
              error.message ||
              'Invalid request body.',
          });
        }

        const result = await handleApplication(
          client,
          config,
          body
        );

        return sendJson(
          res,
          result.status,
          result.data
        );
      }

      return sendJson(res, 404, {
        success: false,
        error: 'Endpoint not found.',
      });
    } catch (error) {
      console.error(
        '[WEB APPLICATION] Failed to handle request:',
        error
      );

      if (!res.headersSent) {
        return sendJson(res, 500, {
          success: false,
          error: 'Failed to submit application.',
        });
      }

      res.end();
    }
  });

  server.on('error', (error) => {
    console.error(
      '[WEB APPLICATION] Server error:',
      error
    );
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(
      `[WEB APPLICATION] API listening on port ${port}`
    );
  });

  return server;
}

module.exports = {
  startWebApplicationServer,
};
