# pg-transactions

This is a Javascript library modeled heavily on the DBConnection interface in
C#, and Go's database/sql library.

[What are transactions?][txns] At a basic level, they let you update multiple
records (or multiple tables) and guarantee that all of the updates succeed
or all of them fail. They also ensure the rest of your application can't see
the transaction's intermediate states - they can see all of the data (when
the transaction is committed) or none of it. These are exceptionally valuable
properties for guaranteeing the consistency of your data - **properties that
many NoSQL databases (like MongoDB) cannot provide**.

[txns]: http://www.postgresql.org/docs/9.3/static/tutorial-transactions.html

The quintessential example is updating two bank records; say I want to
decrement User A's balance by ten dollars and increment User B's balance by
ten dollars. I *really* want those updates to both succeed or both fail, and
I *really* want to make sure I can never read a partially applied balance
transaction, otherwise I can end up with an inconsistent amount of money in the
system!

We use them in several places at [Shyp](https://www.shyp.com). When we assign
a pickup to a driver, we want to update the pickup (so it can't be assigned
to a different driver) and update the driver (so they can't be assigned other
pickups). If one of those updates succeeded but not the other one, we'd end up
in a state where the pickup didn't have a driver, or the driver was assigned,
but didn't have a pickup to collect.

## Usage

If you need to make a query, call:

```javascript
DBConnection.get(config, function(err, conn) {
  conn.query('SELECT foo FROM bar', function(err, result) {
    console.log(result.rows[0]);
    conn.release()
  });
});
```

You'll need to release the connection yourself. It's not recommended, but
it's safe to call `conn.release()` twice.

If you need a database transaction, call `DBConnection.begin`:

```javascript
DBConnection.begin(config, function(err, txn) {
  txn.query('UPDATE ... ', function(err, result) {
    txn.rollback(); // or txn.commit()
  });
});
```

The DBTransaction object that's returned has the same interface, but instead
of releasing the connection, call `rollback` or `commit`, which will release
the connection for you.

You should NOT continue to use the connection after calling `release`,
`commit`, or `rollback`.

The DBTransaction object has three methods:

- query, which has the same interface as client.query in the node-postgres library
- commit, which commits the transaction. Note this is asynchronous and accepts
  a callback.
- rollback, which aborts the transaction. Note this is asynchronous and accepts
  a callback.

Example usage:

```javascript
DBConnection.begin(config, function(err, txn) {
  txn.query("UPDATE foo WHERE bar='baz'", function(err, result) {
    txn.query("UPDATE bankaccounts WHERE bar='baz'", function(err, result) {
      if (result.rowCount === 0) {
        txn.rollback(cb);
      } else {
        txn.commit(cb);
      }
    });
  })
});
```

Open transactions are extremely harmful to performance, and should be
avoided. The caller should ensure all code paths are calling commit() or
rollback(). Better yet, just use normal database queries for situations where
it's not critical that two records are updated in sync.

A transaction will also be aborted in the event of a Postgres syntax error,
constraint failure, or a connection error.

## Installation

```bash
make install
```

The library comes with a stub Metrics interface. In our Shyp codebase, we
publish metrics about our database connection usage to our metrics framework.
You will probably want to edit the code here to do likewise, or remove the
calls to Metrics in this library.

This is fairly dangerous code; you should certainly read through it and decide
whether you understand how it behaves in various scenarios, and whether it's
correct, before implementing in your own codebase.

## Running the tests

```bash
make test
```

The tests depend on you having a Postgres server, and they'll attempt to
connect using the default configuration (the database user is your current
user, on localhost, with no password).

## Contributing

We'll accept pull requests for:

- Setting the transaction isolation level! [Defending against read skew, write skew][levels], etc.
- Configuring the database connection in tests - setting the database user or
  password.
- Correctness errors.
- We've observed an issue where [a percentage of our transactions queries log
'This socket has been ended by the other party' errors on disconnect][error].
We observe the transaction was aborted, though we don't understand why we're
getting it. In production we run node-postgres behind PGBouncer, which may be
causing this issue.

[error]: https://github.com/brianc/node-postgres/issues/725

We're unlikely to accept pull requests for:

- Making connections to other backing datastores; you should steal this
  interface and most of the code and release your own library!
- Support for any particular ORM, if it would involve changing the interface
  presented here.
- Grunt/Gulp/editorconfig/other JS lint or build tools.
- Nested transactions or save points; if you need this behavior, you can do it
by running `txn.query('SAVEPOINT')` or `txn.query('ROLLBACK TO SAVEPOINT')`.

[levels]: https://martin.kleppmann.com/2015/09/26/transactions-at-strange-loop.html

## Compatibility

This library should be widely compatible with the `node-postgres` library; it
depends on the `pg.connect(config, (err, client, release)` interface, and the
`client.query(sql, values, callback)` interface. Tests run against the latest
released version of `node-postgres`.
