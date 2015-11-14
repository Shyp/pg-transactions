var should = require('should');
var sinon = require('sinon');

var DBConnection = require('../DBConnection.js');
var DBTransaction = require('../DBTransaction.js');

describe('DBConnection', function() {
  var sandbox = null;
  beforeEach(function() {
    sandbox = sinon.sandbox.create();
  });
  afterEach(function() {
    sandbox.restore();
  });
  describe('when the default pool size is set', function() {
    beforeEach(function() {
      this.originalPoolSize = process.env.PGBOUNCER_MAX_CLIENT_CONN;
      return process.env.PGBOUNCER_MAX_CLIENT_CONN = 7;
    });
    afterEach(function() {
      return process.env.PGBOUNCER_MAX_CLIENT_CONN = this.originalPoolSize;
    });
    return it('configures the pool size properly', function() {
      return DBConnection._getPoolSize().should.equal(7);
    });
  });
  describe('when the default pool size is not set', function() {
    beforeEach(function() {
      this.originalPoolSize = process.env.PGBOUNCER_MAX_CLIENT_CONN;
      return process.env.PGBOUNCER_MAX_CLIENT_CONN = '';
    });
    afterEach(function() {
      return process.env.PGBOUNCER_MAX_CLIENT_CONN = this.originalPoolSize;
    });
    return it('configures the pool size properly', function() {
      return DBConnection._getPoolSize().should.equal(100);
    });
  });
  describe('when the default pool size is not an integer', function() {
    beforeEach(function() {
      this.originalPoolSize = process.env.PGBOUNCER_MAX_CLIENT_CONN;
      return process.env.PGBOUNCER_MAX_CLIENT_CONN = 'foo';
    });
    afterEach(function() {
      return process.env.PGBOUNCER_MAX_CLIENT_CONN = this.originalPoolSize;
    });
    return it('configures the pool size properly', function() {
      return DBConnection._getPoolSize().should.equal(100);
    });
  });
  it('gets a database connection', function(done) {
    return DBConnection.get({}, function(err, conn) {
      if (conn) {
        conn.release(true);
      }
      should(err).not.be.ok();
      return done();
    });
  });
  it('can make queries', function(done) {
    return DBConnection.get({}, function(err, conn) {
      return conn.query('SELECT 1 AS foo', function(err, result) {
        conn.release(true);
        result.rowCount.should.equal(1);
        result.rows.should.eql([
          {
            foo: 1
          }
        ]);
        return done();
      });
    });
  });
  it('can make parameterized queries', function(done) {
    return DBConnection.get({}, function(err, conn) {
      return conn.query('SELECT $1::int AS foo', [1], function(err, result) {
        conn.release(true);
        result.rowCount.should.equal(1);
        result.rows.should.eql([
          {
            foo: 1
          }
        ]);
        return done();
      });
    });
  });
  it('measures the utilization of the pool', function(done) {
    return DBConnection.get({}, function(err, conn) {
      var error;
      try {
        DBConnection._getPoolUtilization().should.equal(1);
        conn.release(true);
        return done();
      } catch (error) {
        err = error;
        conn.release(true);
        return done(err);
      }
    });
  });
  context('calling release more than once', function() {
    it('does not throw an error', function(done) {
      return DBConnection.get({}, function(err, conn) {
        conn.release(true);
        conn.release(true);
        return done();
      });
    });

    it('does not decrement the pool counter twice', function(done) {
      return DBConnection.get({}, function(err, conn) {
        conn.release(true);
        DBConnection._getPoolUtilization().should.equal(0);
        conn.release(true);
        DBConnection._getPoolUtilization().should.equal(0);
        done();
      });
    });
  });

  context('when a connection cannot be established', function() {
    beforeEach(function(done) {
      this.dbErr = new Error('connection failure');
      var that = this;
      DBConnection.get({}, function(err, conn1) {
        conn1.client.query = function(sql, values, cb) {
          return cb(that.dbErr);
        };
        that.conn = conn1;
        done();
      });
    });

    afterEach(function(done) {
      if (this.conn) {
        this.conn.release(true);
      }
      done();
    });

    it('releases connections to the pool', function(done) {
      var that = this;
      this.conn.query('SELECT 1 AS foo', function(err, result) {
        var error;
        try {
          DBConnection._getPoolUtilization().should.equal(0);
          that.conn.release(true);
          return done();
        } catch (error) {
          err = error;
          that.conn.release(true);
          return done(err);
        }
      });
    });

    it('returns an error', function(done) {
      var that = this;
      this.conn.query('SELECT 1 AS foo', function(err, result) {
        var error;
        try {
          should(err).equal(that.dbErr);
          that.conn.release(true);
          return done();
        } catch (error) {
          err = error;
          that.conn.release(true);
          return done(err);
        }
      });
    });
  });
  return describe('begin', function() {
    it('returns a DBTransaction object', function(done) {
      return DBConnection.begin({}, function(err, txn) {
        var error;
        try {
          txn.should.be.an["instanceof"](DBTransaction);
          return txn.rollback(done);
        } catch (error) {
          err = error;
          return txn.rollback(function() {
            return done(err);
          });
        }
      });
    });

    return context('when the connection fails', function() {
      it('returns an error if the connection fails', function(done) {
        var dbErr;
        dbErr = new Error('connection failure');
        return DBConnection.get({}, function(err, conn) {
          conn.client.query = function(sql, values, cb) {
            return cb(dbErr);
          };
          sandbox.stub(DBConnection, 'get', function(config, cb) {
            return cb(null, conn);
          });
          return DBConnection.begin({}, function(err) {
            var error;
            try {
              err.should.equal(dbErr);
              conn.release(true);
              return done();
            } catch (error) {
              err = error;
              conn.release(true);
              return done(err);
            }
          });
        });
      });
      return it('releases connections to the pool', function(done) {
        var dbErr;
        dbErr = new Error('connection failure');
        return DBConnection.get({}, function(err, conn) {
          conn.client.query = function(sql, values, cb) {
            return cb(dbErr);
          };
          sandbox.stub(DBConnection, 'get', function(config, cb) {
            return cb(null, conn);
          });
          return DBConnection.begin({}, function(err) {
            var error;
            try {
              DBConnection._getPoolUtilization().should.equal(0);
              conn.release(true);
              return done();
            } catch (error) {
              err = error;
              conn.release(true);
              return done(err);
            }
          });
        });
      });
    });
  });
});
