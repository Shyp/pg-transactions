var pg = require('pg');
var should = require('should');

var DBConnection = require('../DBConnection');
var DBTransaction = require('../DBTransaction');

var getPhoto = function(id, callback) {
  pg.connect(function(err, client, release) {
    client.query('SELECT * FROM photos WHERE id = $1', [id], function(err, result) {
      release(true);
      callback(err, result.rows[0]);
    });
  });
};

describe('DBTransaction', function() {
  before(function(done) {
    pg.connect(function(err, client, release) {
      if (err) {
        done(err);
        return;
      }
      client.query('DROP TABLE IF EXISTS photos; CREATE TABLE photos (id text)', function(err, result) {
        release(true);
        done(err);
        return;
      });
    });
  });

  afterEach(function(done) {
    pg.connect(function(err, client, release) {
      if (err) {
        done(err);
        return;
      }
      // DELETE FROM much faster than TRUNCATE for small workloads
      client.query('DELETE FROM photos;', function(err, result) {
        release(true);
        done(err);
        return;
      });
    });
  });

  it('should successfully commit a transaction', function(done) {
    return DBConnection.begin({}, function(err, txn) {
      return txn.query("INSERT INTO photos (id) VALUES ('pho_123')", function(err, result) {
        return txn.commit(function(err) {
          should(err).equal(null);
          return getPhoto('pho_123', function(err, photo) {
            photo.id.should.equal('pho_123');
            return done();
          });
        });
      });
    });
  });
  it('changes made in a transaction should not be visible to other transactions', function(done) {
    return DBConnection.begin({}, function(err, txn) {
      return txn.query("INSERT INTO photos (id) VALUES ('pho_123')", function(err, result) {
        return DBConnection.begin({}, function(err, txn2) {
          return txn2.query("SELECT * FROM photos WHERE id='pho_123'", function(err, result) {
            var error;
            try {
              result.rows.should.eql([]);
              return txn.rollback(function() {
                return txn2.rollback(done);
              });
            } catch (error) {
              err = error;
              return txn.rollback(function() {
                return txn2.rollback(function() {
                  return done(err);
                });
              });
            }
          });
        });
      });
    });
  });
  it('changes made in a transaction should not be visible to other queries', function(done) {
    return DBConnection.begin({}, function(err, txn) {
      return txn.query("INSERT INTO photos (id) VALUES ('pho_123')", function(err, result) {
        return getPhoto('pho_123', function(err, photo) {
          var error;
          try {
            should(photo).not.be.ok();
            return txn.rollback(done);
          } catch (error) {
            err = error;
            return txn.rollback(function() {
              return done(err);
            });
          }
        });
      });
    });
  });
  it('changes should not be visible after rollback', function(done) {
    return DBConnection.begin({}, function(err, txn) {
      return txn.query("INSERT INTO photos (id) VALUES ('pho_123')", function(err, result) {
        return txn.rollback(function(err) {
          should(err).equal(null);
          return getPhoto('pho_123', function(err, photo) {
            should(photo).not.be.ok();
            return done();
          });
        });
      });
    });
  });
  it('changes should be visible inside of a transaction', function(done) {
    return DBConnection.begin({}, function(err, txn) {
      return txn.query("INSERT INTO photos (id) VALUES ('pho_123')", function(err, result) {
        return txn.query("SELECT * FROM photos WHERE id='pho_123'", function(err, result) {
          var error;
          try {
            result.rowCount.should.equal(1);
            result.rows[0].id.should.equal('pho_123');
            return txn.rollback(done);
          } catch (error) {
            err = error;
            txn.rollback();
            return done(err);
          }
        });
      });
    });
  });
  it('should release connections after a commit', function(done) {
    DBConnection._getPoolUtilization().should.equal(0);
    return DBConnection.begin({}, function(err, txn) {
      return txn.commit(function(err) {
        DBConnection._getPoolUtilization().should.equal(0);
        return done();
      });
    });
  });
  it('should check out a single connection', function(done) {
    DBConnection._getPoolUtilization().should.equal(0);
    DBConnection.begin({}, function(err, txn) {
      DBConnection._getPoolUtilization().should.equal(1);
      txn.commit(done);
    });
  });
  it('should release connections after a rollback', function(done) {
    DBConnection._getPoolUtilization().should.equal(0);
    return DBConnection.begin({}, function(err, txn) {
      return txn.rollback(function(err) {
        DBConnection._getPoolUtilization().should.equal(0);
        return done();
      });
    });
  });
});
