
[SMB/CIFS]: http://en.wikipedia.org/wiki/Server_Message_Block
[BACKENDS]: lib/backends
[CONFIG]: config.json
[INSTALLATION]: #installation
[STANDALONE]: #running-a-standalone-server
[USERMGMT]: #user-management
[CONFIGURATION]: #configuration
[CUSTOMBACKEND]: #developing-a-custom-backend
[TESTING]: #unit-testing
[MODULE]: #smb-server-as-a-module
[STATUS]: #current-status
[TODOS]: #todos
[SPEC]: spec
[SHARECONFIGS]: #share-configurations
[SPI]: lib/spi
[JASMINE]: https://jasmine.github.io/

# SMB Server for Node.js

## Overview

**node-smb-server** is an open-source JavaScript implementation of the [SMB/CIFS][] file sharing protocol. 

Some highlights:

* Pure JavaScript
* Fully configurable/customizable
* Extensible: supports exposing non filesystem-based data as a mountable file system via an abstract 
backend, similar to Samba's VFS 

## Contents

1. [Installation][INSTALLATION]
1. [Running a Standalone Server][STANDALONE]
1. [User Management][USERMGMT]
1. [Configuration][CONFIGURATION]
1. [Developing a Custom Backend][CUSTOMBACKEND]
1. [Unit Testing][TESTING]
1. [SMB Server as a Module][MODULE]
1. [Current Status][STATUS]
1. [ToDo's][TODOS]

## Installation
Install latest release version from NPM:
```
npm install node-smb-server
```

Install from source code:
```
git clone https://github.com/adobe/node-smb-server.git
cd node-smb-server
npm install
```

## Running a Standalone Server

Execute the following commands in a terminal:
```
cd <node-smb-server install dir>
npm start
```

In Finder, open the 'Connect to Server' dialog (⌘K) and enter the url `smb://localhost:8445/fs` (user: `test`, password: `test`).

## User management

The following users are pre-configured by default when running standalone: `test/test`, `admin/admin`, `guest/<empty password>`

Users can be edited in the [configuration][CONFIG] file:
```
...
"users" : {
    "test" : {
      "lmHash" : "01fc5a6be7bc6929aad3b435b51404ee",
      "ntlmHash" : "0cb6948805f797bf2a82807973b89537"
    },
    "admin" : {
      "lmHash" : "f0d412bd764ffe81aad3b435b51404ee",
      "ntlmHash" : "209c6174da490caeb422f3fa5a7ae634"
    },
    "guest" : {
      "lmHash" : "aad3b435b51404eeaad3b435b51404ee",
      "ntlmHash" : "31d6cfe0d16ae931b73c59d7e0c089c0"
    }
  }
...
```

Password hashes can be computed by running:
```
node createhash.js
```

## Configuration

The standalone server reads its configuration [from file][CONFIG]. When using the SMB Server as a module, the configuration is
passed to the module's constructor.

The server supports the following configuration options:

* _listen_: (Standalone only) Specifies where the server should listen for connections when 
 running in standalone mode. Supports the following elements:
  * _port_: The port on which the standalone server should listen. Default: 445.
  * _host_: The IP address or host name on which the standalone server should listen. 
  Default: 0.0.0.0.
* _domainName_: The domain value that the server will use for [domain-based authentication][SMB/CIFS]. 
Default: empty string.
* _smb2Support_: If true, the server will use the SMB2 protocol. Otherwise uses SMB1. 
Default: false.
* _extendedSecurity_: If true, enables [extended security][SMB/CIFS] capabilities when authenticating. 
Default: false.
* _users_: Specifies username/password combinations that can authenticate with the server.
 See [User Management][USERMGMT] for more information. Default: no users.
* _shares_: Specifies which shares the server will use, and provides configuration options
for each. See [Share Configurations][SHARECONFIGS] for more information. Default: no shares. 

### Share Configurations
Each share supports the following options by default:

* _name_: A unique value used to identify the share. In addition, the name is 
used when determining which sub-directory of 
[the backends folder][BACKENDS] that the server will use to load the share's 
module. It will also determine the path to use when connecting to the share. 
For example, the URL for connecting to a share whose name is `fs` would be 
`smb://localhost:8445/fs`, and the server will `require` the share from `lib/backends/fs/share`.
* _description_: An arbitrary value that will be displayed as the smb mount's description.

See individual [backend documentation][BACKENDS] for share-specific 
configurations.

The following is a sample `shares` configuration element. Each share's element name 
(`FS` and `JCR` in the example) is arbitrary.
```
...
 "shares": {
    "FS": {
      "backend": "fs",
      "description": "fs-based test share",
      "path": "./smbroot"
    },
    "JCR": {
      "backend": "jcr",
      "description": "AEM-based test share",
      "host": "localhost",
      "port": 4502,
      "protocol": "http:",
      "auth": {
        "user": "<user>",
        "pass": "<pwd>"
      },
      "path": "/",
      "maxSockets": 64,
      "contentCacheTTL": 30000,
      "binCacheTTL": 600000
    },
...
```

## Developing a custom backend

Consider the following example use case:

*You would like to enable your desktop applications to access data and documents stored in a RDBMS or a Cloud-based 
service.*

You could write a custom backend by implementing the `Share`, `TreeConnection`, `Tree`, `FileConnection`, and `File` 
interfaces of the virtual [SPI backend][SPI]. Check out the [existing 
implementations][BACKENDS] to see examples.  

## Unit Testing
The SMB Server has a fairly extensive set of unit tests, along with a constantly evolving test framework designed
for easily writing unit tests in a contained environment. The framework swaps common dependencies like `fs`, `request`,
and `stream` with mock implementations.

### Running Tests
To run existing tests, do the following:

1. [Install][INSTALLATION] the server's source code.
1. Switch to the unit test directory using `cd spec`.
1. Install test dependencies using `npm install`.
1. Run the tests using `npm test`.

### Creating New Tests
The tests use [Jasmine][JASMINE] as the test harness. To add a new test, create a new file
anywhere beneath the [test directory][SPEC]; the new file name should end in `-spec.js`. For example,
`my_new_test-spec.js`. The `npm test` command will automatically pick up the new file and run any tests inside it.

To take advantage of the framework's built-in mocking capabilities, use `TestCommon.require` when importing modules
into your test case. For example, the following code will include the module from `/lib/backends/fs/tree`, and will
automatically substitute modules that the common framework supports with mock implementations:

```javascript
var TestCommon = require('./test-common.js');

var FSTree = TestCommon.require(__dirname, '../lib/backends/fs/tree');

describe('Suite description', function () {
  it('Test case description', function () {
    // your test case here.
  });
});
```

`requireStubs` is an alternate version of `require` that takes additional dependencies to mock. 
Implementation of these mocks is an exercise left up to the caller.

## SMB Server as a Module
The SMB Server can be run either as a standalone server, or consumed as a module in external applications. To include
the server as a module:

1. Import the server into your application using `var SMBServer = require('node-smb-server/lib/smbserver');`
1. Create a new instance of the server using its constructor.
1. Interact with the server using its methods. This will typically consist of calling `start`, followed by use-case
specific calls, then concluded by calling `stop`.

### Communicating with the Server

When using the server as a module, it's possible to programmatically communicate with the server using events. The 
SMBServer object itself is an event emitter and provides the following events:
* _error_: The server's TCP connection has encountered an unhandled error.
  * (String) _error_: Details of the error.
* _terminated_: The server's TCP connection has closed.
* _started_: The server has completed its startup routine successfully.
* _shareConnected_: One of the server's shares has connected successfully.
  * (String) _share_: The name of the share.
* _shareDisconnected_: One of the server's shares has disconnected successfully.
  * (String) _share_: The name of the share.
* _folderListed_: A share has listed the contents of a folder.
  * (String) _share_: The name of the share.
  * (String) _path_: Path to the folder.
* _fileCreated_: A new file was created by a share.
  * (String) _share_: The name of the share.
  * (String) _path_: Path to the file.
* _folderCreated_: A new folder was created by a share.
  * (String) _share_: The name of the share.
  * (String) _path_: Path to the folder.
* _fileDeleted_: A share has deleted a file.
  * (String) _share_: The name of the share.
  * (String) _path_: Path to the file.
* _folderDeleted_: A share has deleted a folder.
  * (String) _share_: The name of the share.
  * (String) _path_: Path to the folder.
* _itemMoved_: A share has moved a file or folder.
  * (String) _share_: The name of the share.
  * (String) _oldPath_: Old path of the file or folder.
  * (String) _newPath_: New path of the file or folder
* _serverEvent_: A more generic means of sending events from the server. The primary purpose of this
event is to allow a simple "passthrough" mechanism that the server's backends can use
to emit backend-specific events. Refer to an individual [backend's documentation][BACKENDS] to see which 
events each one supports.
  * (Object) _data_: Details about the event.
    * (String) _event_: The name of the event.
    * (Object) _data_: Extended information specific to the event.
  

The SMB Server also provides a way for sending events <i>to</i> the server. Use a server instance's
`processEvent` method to pass events and event data. Refer to an individual 
[backend's documentation][BACKENDS] for a list of which events the server supports. 

## Current Status

* Implements CIFS and MS-SMB 1.0.
* Support for SMB2 is currently work in progress.
* Supports LM, LMv2, NTLM, NTLMSSP authentication protocols
* [Supported backends][BACKENDS]
* Tested with Finder on OS X (Yosemite, El Capitan, Sierra).

## ToDo's

* Test with other clients on other platforms (Windows, Linux).
* Add more test cases/suites
* CIFS/SMB:
   * missing NT_TRANSACT subcommands
   * missing TRANSACTION subcommands
   * missing TRANSACTION2 subcommand information levels
   * missing CIFS commands:
     * TRANSACTION_SECONDARY
     * TRANSACTION2_SECONDARY
     * NT_TRANSACT_SECONDARY
     * OPEN_PRINT_FILE
* support for named streams?
* SMB Signing?
* proper implementation of LOCKING_ANDX?
* Check/Implement the following protocol extensions/versions:
  * SMB2/3

