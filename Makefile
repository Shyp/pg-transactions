.PHONY: clean install test

install:
	npm install mocha pg sinon should

test:
	./node_modules/.bin/mocha

clean:
	rm -rf node_modules
