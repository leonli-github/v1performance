/**
 * Copyright 2016 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an 'AS IS' BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

var path = require('path');
var fs = require('fs-extra');
var os = require('os');

var jsrsa = require('jsrsasign');
var KEYUTIL = jsrsa.KEYUTIL;

var copService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
var User = require('fabric-client/lib/User.js');
var CryptoSuite = require('fabric-client/lib/impl/CryptoSuite_ECDSA_AES.js');
var KeyStore = require('fabric-client/lib/impl/CryptoKeyStore.js');
var ecdsaKey = require('fabric-client/lib/impl/ecdsa/key.js');

module.exports.CHAINCODE_PATH = 'github.com/example_cc';
module.exports.CHAINCODE_MARBLES_PATH = 'github.com/marbles_cc';

// directory for file based KeyValueStore
module.exports.KVS = '/tmp/hfc-test-kvs';

// temporarily set $GOPATH to the test fixture folder
module.exports.setupChaincodeDeploy = function() {
	process.env.GOPATH = path.join(__dirname, '../fixtures');
};

// specifically set the values to defaults because they may have been overridden when
// running in the overall test bucket ('gulp test')
module.exports.resetDefaults = function() {
	global.hfc.config = undefined;
};

module.exports.cleanupDir = function(keyValStorePath) {
	var absPath = path.join(process.cwd(), keyValStorePath);
	var exists = module.exports.existsSync(absPath);
	if (exists) {
		fs.removeSync(absPath);
	}
};


// utility function to check if directory or file exists
// uses entire / absolute path from root
module.exports.existsSync = function(absolutePath /*string*/) {
	try  {
		var stat = fs.statSync(absolutePath);
		if (stat.isDirectory() || stat.isFile()) {
			return true;
		} else
			return false;
	}
	catch (e) {
		return false;
	}
};

module.exports.readFile = readFile;

function getSubmitter(username, password, client, loadFromConfig) {
	return client.getUserContext(username)
	.then((user) => {
		return new Promise((resolve, reject) => {
			if (user && user.isEnrolled()) {
				console.log('util: Successfully loaded member from persistence');
				return resolve(user);
			}

			if (!loadFromConfig) {
				// need to enroll it with CA server
				var cop = new copService('http://localhost:7054');

				var member;
				return cop.enroll({
					enrollmentID: username,
					enrollmentSecret: password
				}).then((enrollment) => {
					console.log('Successfully enrolled user \'' + username + '\'');

					member = new User(username, client);
					return member.setEnrollment(enrollment.key, enrollment.certificate);
				}).then(() => {
					return client.setUserContext(member);
				}).then(() => {
					return resolve(member);
				}).catch((err) => {
					console.log('Failed to enroll and persist user. Error: ' + err.stack ? err.stack : err);
					process.exit();
				});
			} else {
				// need to load private key and pre-enrolled certificate from files based on the MSP
				// config directory structure:
				// <config>
				//    \_ keystore
				//       \_ admin.pem  <<== this is the private key saved in PEM file
				//    \_ signcerts
				//       \_ admin.pem  <<== this is the signed certificate saved in PEM file

				// first load the private key and save in the BCCSP's key store
				var privKeyPEM = path.join(__dirname, '../fixtures/msp/local/keystore/admin.pem');
				var pemData, member;
				return readFile(privKeyPEM)
				.then((data) => {
					pemData = data;
					// default crypto suite uses $HOME/.hfc-key-store as key store
					var kspath = CryptoSuite.getDefaultKeyStorePath();
					var testKey;
					return new KeyStore({
						path: kspath
					});
				}).then((store) => {
					var rawKey = KEYUTIL.getKey(pemData.toString());
					testKey = new ecdsaKey(rawKey);
					return store.putKey(testKey);
				}).then((value) => {
					// next save the certificate in a serialized user enrollment in the state store
					var certPEM = path.join(__dirname, '../fixtures/msp/local/signcerts/admin.pem');
					return readFile(certPEM);
				}).then((data) => {
					member = new User(username, client);
					return member.setEnrollment(testKey, data.toString());
				}).then(() => {
					return client.setUserContext(member);
				}).then((user) => {
					return resolve(user);
				}).catch((err) => {
					reject(new Error('Failed to load key or certificate and save to local stores. ' + err));
					t.end();
				});
			}
		});
	});
}

function readFile(path) {
	return new Promise((resolve, reject) => {
		fs.readFile(path, (err, data) => {
			if (!!err)
				reject(new Error('Failed to read file ' + path + ' due to error: ' + err));
			else
				resolve(data);
		});
	});
}

module.exports.getSubmitter = function(username, password, client, loadFromConfig) {
	return getSubmitter(username, password, client, loadFromConfig);
};
