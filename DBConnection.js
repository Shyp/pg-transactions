/*
 * Database connection interface modeled heavily on Go's database/sql library.
 *
 * If you need to make a query, call:
 *
 * DBConnection.get (err, conn) ->
 *   conn.query 'SELECT foo FROM bar', (err, result) ->
 *     console.log result.rows[0]
 *     conn.release()
 *
 * You'll need to release the connection yourself. It's not recommended, but
 * it's safe to call `conn.release()` twice.
 *
 * If you need a database transaction, call `DBConnection.begin`:
 *
 *  DBConnection.begin (err, txn) ->
 *    txn.query 'UPDATE ... ', (err, result) ->
 *      txn.rollback() # or txn.commit()
 *
 * The DBTransaction object that's returned has the same interface, but instead
 * of releasing the connection, call `rollback` or `commit`, which will release
 * the connection for you.
 *
 * You should NOT continue to use the connection after calling `release`,
 * `commit`, or `rollback`.
 *
 * This library is callback-based because the underlying library relies heavily
 * on it. If you need a Promise based interface, wrap the calling functions in
 * Promise.promisify calls.
 */
var DBConnection;

var pg = require('pg');

var DBTransaction = require('./DBTransaction.js');
var Metrics = require('./Metrics.js');

var DEFAULT_CONNECTION_POOL_SIZE = 100;

module.exports = DBConnection = function(client, releaseFn) {
  this.client = client;
  this.releaseFn = releaseFn;
  this._released = false;
};

/*
 * Get a new database connection. Will hit the callback with (err,
 * DBConnection). Extensive documentation for the parameters can be found
 * here: https://github.com/brianc/node-postgres/wiki/pg#method-connect
 *
 * The caller is responsible for releasing the connection by calling
 * release(true) when they are finished with the query. Otherwise it will stay
 * open for up to 30 seconds.
 *
 * NB: This will block if all connections in the pool are checked out! If
 * latency is important, consider setting a timeout and canceling the query.
 * More discussion here: https://github.com/brianc/node-postgres/issues/805
 */
DBConnection.get = function(config, cb) {
  DBConnection._setPoolSize();
  var start = Date.now();
  pg.connect(config, function(err, client, release) {
    if (err !== null && typeof err !== "undefined") {
      return cb(err);
    }
    try {
      var poolUtilization = DBConnection._getPoolUtilization();
      Metrics.measure('db.txn_conn_pool.count', poolUtilization);
    } catch (undefined) {}
    Metrics.measure('db.txn_conn_pool.total', pg.defaults.poolSize);
    Metrics.increment('db.txn_conn_pool.get');
    Metrics.timing('db.txn_conn_pool.get.latency', start);
    cb(err, new DBConnection(client, release));
  });
};

/*
 * Begin gets a new connection and begins a transaction. Hits the callback
 * with an error or a DBTransaction object.
 *
 * The caller is responsible for calling commit() or rollback() to complete
 * the transaction in every code path; open transactions crush database
 * performance. If Postgres returns a syntax error, the client loses the
 * connection, or there's a connection timeout, the connection should
 * automatically be released.
 */
DBConnection.begin = function(config, cb) {
  return DBConnection.get(config, function(err, conn) {
    if (err) {
      return cb(err);
    }
    return conn.query('BEGIN', function(err) {
      if (err) {
        Metrics.increment('db.txn.begin.error');
        return cb(err);
      }
      Metrics.increment('db.txn.begin.success');
      return cb(null, new DBTransaction(conn));
    });
  });
};

/*
 * Query makes the given query to the database. If the query fails with a
 * connection error or Postgres error, this will release the connection before
 * hitting the callback with an error.
 *
 * Query accepts two different signatures:
 *
 * (sql, cb): A SQL command to execute and a callback to hit
 * (sql, values, cb): A SQL command to execute, an array of values to
 *   interpolate into the query (parameters), and a callback to hit.
 */
DBConnection.prototype.query = function(sql, values, cb) {
  if (cb === null || typeof cb === "undefined") {
    cb = values;
    values = [];
  }
  var that = this;
  this.client.query(sql, values, function(err, res) {
    if (err) {
      that.release(true);
      return cb(err);
    }
    return cb(null, res);
  });
};

/*
 * Release this connection back to the pool. `dispose=true` will destroy
 * the underlying connection object - it's the safest mode, in case PG is
 * still trying to send back data, but may result in unnecessary connection
 * teardowns/latency.
 */
DBConnection.prototype.release = function(dispose) {
  var poolUtilization;
  if (this._released) {
    return;
  }
  this.releaseFn(dispose);
  this._released = true;
  poolUtilization = DBConnection._getPoolUtilization();
  return Metrics.measure('db.txn_conn_pool.release.count', poolUtilization);
};

DBConnection._setPoolSize = function() {
  return pg.defaults.poolSize = DBConnection._getPoolSize();
};

DBConnection._getPoolSize = function() {
  var defaultPoolSize;
  defaultPoolSize = parseInt(process.env.PGBOUNCER_MAX_CLIENT_CONN, 10);
  if (defaultPoolSize > 0) {
    return defaultPoolSize;
  } else {
    return DEFAULT_CONNECTION_POOL_SIZE;
  }
};

/*
 * getPoolUtilization synchronously returns the current number of open
 * connections as an integer, or throws an error if that number can't be
 * determined.
 */
DBConnection._getPoolUtilization = function() {
  var key, pool;
  key = Object.keys(pg.pools.all)[0];
  if (key != null) {
    pool = pg.pools.all[key];
    if (pool != null) {
      size = pool.getPoolSize();
      return size;
    }
  }
  throw new Error("DBConnection: Couldn't get pool size. Make sure at least one connection's been made");
};
