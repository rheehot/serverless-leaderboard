import "../utils/sourceMap";

import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import elapsed, { elapsedSync } from "../elapsed";

import CreateRankingTableSQL from "../db/CreateRankingTableSQL";
import SqliteDbContext from "../models/SqliteDbContext";
import api from "../utils/api";
import fetchRanking from "../db/fetchRanking";
import findMyNearRanking from "../db/findMyNearRanking";
import { rankRecordAsResponse } from "../models/RankResponse";
import resolveResourceIdFromEvent from "../utils/resolveResourceIdFromEvent";
import withRedisConnection from "../redis/withRedisConnection";
import withSqliteDatabase from "../sqlite/withSqliteDatabase";

function fetchData({
  db,
  offset,
  limit,
  userId,
  around,
}: Pick<SqliteDbContext, "db"> & {
  offset: string;
  limit: string;
  userId: string;
  around: string;
}) {
  const topRanks = rankRecordAsResponse(fetchRanking({ db, offset, limit }));
  const aroundRanks = userId
    ? rankRecordAsResponse(findMyNearRanking({ db, userId, around }))
    : undefined;
  const myRank =
    userId && aroundRanks
      ? aroundRanks.find((record) => record.user === userId)
      : undefined;
  return { top: topRanks, around: aroundRanks, my: myRank };
}

const measuredFetchData = elapsedSync(fetchData);

async function handleGetAll(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const resourceId = resolveResourceIdFromEvent(event);
  const userId = event.headers["x-user"];
  const { offset = "0", limit = "10", around = "10" } =
    event.queryStringParameters ?? {};
  const result = await withRedisConnection({
    doIn: async (redisConnection) =>
      await withSqliteDatabase({
        connection: redisConnection,
        resourceId,
        createTableQuery: CreateRankingTableSQL,
        doIn: async ({ db }) =>
          measuredFetchData({ db, offset, limit, userId, around }),
      }),
  });
  return {
    statusCode: 200,
    body: JSON.stringify(result),
  };
}

export const handle: APIGatewayProxyHandler = api(elapsed(handleGetAll));
