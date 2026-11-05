-- All keys share an activity/customer hash slot. Use Redis time across replicas.
local stamp = redis.call('TIME')
local now = tonumber(stamp[1]) * 1000 + math.floor(tonumber(stamp[2]) / 1000)
local window = tonumber(ARGV[1])
local cutoff = now - window
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', cutoff)
for _, member in ipairs(expired) do redis.call('HDEL', KEYS[3], member) end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', cutoff)
local function delay(key)
  local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return math.max(1, tonumber(first[2]) + window - now)
end
-- Replays have a generous request budget as well: a reused key is not unlimited admission.
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return {0, delay(KEYS[1])} end
redis.call('ZADD', KEYS[1], now, ARGV[7])
redis.call('PEXPIRE', KEYS[1], window + 1000)
if ARGV[6] == '1' then return {2, 0} end
local fingerprint = redis.call('HGET', KEYS[3], ARGV[4])
if fingerprint then
  if fingerprint ~= ARGV[5] then return {-1, 0} end
  return {2, 0}
end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return {0, delay(KEYS[2])} end
redis.call('ZADD', KEYS[2], now, ARGV[4])
redis.call('HSET', KEYS[3], ARGV[4], ARGV[5])
redis.call('PEXPIRE', KEYS[2], window + 1000)
redis.call('PEXPIRE', KEYS[3], window + 1000)
return {1, 0}
