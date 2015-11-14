/*
 * Copyright 2015 Shyp, Inc.
 *
 * Transaction interface heavily based on Go's database/sql library
 *
 * Get a transaction
 *
 *   DBConnection.begin (err, txn) ->
 *     ... Work with the transaction object..
 *
 * The DBTransaction object has three methods:
 *
 * - query, which has the same interface as client.query in the node-postgres library
 * - commit, which commits the transaction
 * - rollback, which aborts the transaction
 *
 * Example usage:
 *
 *   DBConnection.begin (err, txn) ->
 *     txn.query 'UPDATE foo WHERE bar='baz', (err, result) ->
 *       txn.query 'UPDATE bankaccounts WHERE bar='baz', (err, result) ->
 *         if result.rows is 0
 *           txn.rollback cb
 *         else
 *           txn.commit cb
 *
 * Open transactions are extremely harmful to performance, and should be
 * avoided. The caller should ensure all code paths are calling commit() or
 * rollback(). Better yet, just use normal database queries for situations where
 * it's not critical that two records are updated in sync.
 *
 * A transaction will also be aborted in the event of a Postgres syntax error
 * or a connection error.
 */
var DBTransaction;
var Metrics = require('./Metrics');

module.exports = DBTransaction = function (conn) {
  this.conn = conn;
}

DBTransaction.prototype.rollback = function(cb) {
  var that = this;
  return this.conn.query('ROLLBACK', function(err) {
    if (err) {
      Metrics.increment('db.txn.rollback.error');
      if (cb) {
        cb(err);
      }
      return;
    }
    Metrics.increment('db.txn.rollback.success');
    that.conn.release(true);
    if (cb) {
      return cb(null);
    }
  });
};

DBTransaction.prototype.query = function() {
  this.conn.query.apply(this.conn, arguments);
};

DBTransaction.prototype.commit = function(cb) {
  var that = this;
  return this.conn.query('COMMIT', function(err) {
    if (err) {
      Metrics.increment('db.txn.commit.error');
      if (cb) {
        cb(err);
      }
      return;
    }
    Metrics.increment('db.txn.commit.success');
    that.conn.release(true);
    if (cb) {
      return cb(null);
    }
  });
};
