[FSTREE]: ../fs
[REQUEST]: https://github.com/request/request
[TEMP]: #temporary-files
[CACHING]: #caching
[CONFIG]: #configuration

# Java Content Repository Backend

## Overview

Backend that displays a remote Java Content Repository's structure as the SMB mount's content. 
As files and folders are created, modified, or deleted through the share, they'll be modified in the 
target JCR. Communication with the JCR is done through the JSON servlet at 
`/crx/server/crx.default/jcr%3aroot`, so the mount will show any content provided by that servlet.

## Configuration

* _host_: Host name or IP address of the JCR URL to use as the backend's data source. Default: empty.
* _port_: Port of the JCR URL to use as the backend's data source. Default: 80.
* _protocol_: Protocol of the JCR URL to use as the backend's data source. Should be of the format `http:` or `https:`.
Default: `https:`.
* _auth_: Object containing authentication information that the backend will use when connecting to the target JCR. This
object will be passed as to the [request][REQUEST] module as the `auth` option when sending HTTP requests to the JCR. 
Refer to the module's HTTP Authentication section documentation about all supported options. The following is a subset
of common options. Default: empty.
  * _user_: User name to use for basic authentication.
  * _pass_: Password to use for basic authentication.
  * _bearer_: Bearer token to use for bearer authentication.
* _path_: If specified, this path will be appended to the JSON servlet URL that the backend uses to communicate with
the target JCR. For example, if set to `/somepath`, then the backend will use 
`/crx/server/crx.default/jcr%3aroot/somepath` as the root path for all HTTP requests it sends to the JCR. Default: 
empty.
* _maxSockets_: Passed to the [request][REQUEST] module as the `maxSockets` element of the `pool` configuration option.
Sets the max number of sockets for all agents. See module documentation for additional details. Default: 32.
* _allCacheTTL_: The frequency, in milliseconds, that _all_ of the backend's [caches][CACHING] should be cleared. This
option is unrelated to the amount of time a cache has lived; it simply clears everything if the amount of time elapsed
since the last full cache clear meets this value. Default: 1800000.
* _contentCacheTTL_: When the backend [caches][CACHING] content, it records the time that the
data was cached. If the amount of time elapsed (in milliseconds) meets this configuration value, then the backend
will clear the cached data and re-cache it. Default: 30000.
* _binCacheTTL_: When the backend [caches][CACHING] binaries, it records the time that the binary was cached. If the
amount of time elapsed (in milliseconds) meets this configuration value, then the backend will clear the cached
binary and re-cache it. Default: 300000.
* _strictSSL_: If false, the backend will not enforce strict SSL settings when sending HTTP requests to the target JCR.
A common use-case for using this setting would be if the server is using a self-signed certificate, or if the 
certificate chain is not correctly configured. Default: true.
* _tmpPath_: If specified, this local path will be used to store all [temporary files][TEMP] that the server processes.
Note that if this value is set, the directory will _not_ be automatically cleaned up. Default: empty.
* _tmpDir_: If specified, this directory will be used as the managed temp file location. This will replace the OS's
default temp directory (i.e. `/var/tmp`). Unlike _tmpPath_, this option will preserve automatic cleanup of temp files.
* _options_: An Object that will be used as the options for the node.js [request][REQUEST] module when sending HTTP 
requests to the JCR. Default: empty.
      
## Temporary Files

The backend does not create, modify, or delete temporary files in the JCR. Instead, it will use an
[FSTree][FSTREE] to keep all temporary files in a local directory. By default the backend will use a directory
in the operating system's designated temporary files location, but this behavior can be overridden using a
configuration option. If using the default behavior then the temp files will be automatically cleaned up
over time.

## Caching

The backend caches certain things from the JCR in an effort to improve performance and reduce the overhead of HTTP
communication. The amount of time that the cache data is valid is defined through the backend's [configuration][CONFIG].
The following is an overview of what is cached.

#### Content

The JCR content that the backend caches comes in two flavors: folder listings and file information. Folder listings
consist of the child files and folders of a given directory. File information is data about an individual folder or
file, such as last modified date or file size. When the backend requests content from the JCR, it will cache it for
a period of time defined in the configuration. While content is cached and valid, the backend will return content
from the in-memory cache instead of sending HTTP requests to the JCR to retrieve the information.

#### Binaries

When the backend needs to read from or write to a file, it will first download the file from the JCR to a temporary
path on the local file system. Files downloaded in this manner are automatically cleand up on a regular basis. Once the 
binary is cached, all reads and writes to the file are redirected to the local file. When the file is closed, the 
backend will upload the modified version of the file to the JCR.

The amount of time that a cached file is valid is defined in the configuration. If a cached file expires, the backend
will remove the local file and download a fresh copy of it from the JCR.

## Events

Below are events that the backend will send via the SMB Server's generic `serverEvent` event. The event's name will be
in the `serverEvent` `eventData.event` variable, and the event's data will be in the `eventData.data` variable. 

* _downloadstart_: The backend has started to download a file from the JCR.
  * (Object) _data_: Data for the event.
    * (String) _path_: The downloading file's path.
* _downloaderr_: Sent when an error occurs while downloading a file from the JCR.
  * (Object) _data_: Data for the event.
    * (String) _path_: The downloading file's path.
    * (String) _err_: Details of the error message. 
* _longdownload_: If a file takes longer than 3 seconds to download, then the backend sends this event. The event will
only be sent a maximum of once every 30 seconds.
  * (Object) _data_: Data for the event.
    * (String) _path_: The downloading file's path.
* _downloadprogress_: Sent on a regular interval (approximately once every second) while a file is downloading.
  * (Object) _data_: Data for the event.
    * (String) _path_: The downloading file's path.
    * (Number) _read_: Number of bytes that have been downloaded so far. 
    * (Number) _total_: Total number of bytes to download. **Note:** A value of 0 indicates that the total file size is
    unknown.
    * (Number) _rate_: The rate at which the file is downloading, in bytes per second.
    * (Number) _elapsed_: The amount of time that has elapsed since the download started, in milliseconds.
* _downloadend_: The backend has finished downloading a file from the JCR.
  * (Object) _data_: Data for the event.
    * (String) _path_: The downloading file's path.
* _downloadabort_: Download of a file from JCR share was cancelled prematurely.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being downloaded.
* _syncfilestart_: Emitted when the backend begins uploading a file to JCR.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being uploaded.
    * (String )_method_: The HTTP method being used to upload the file.
* _syncfileend_: Sent when the backend finishes uploading a file to JCR.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the uploaded file.
    * (String) _method_: The HTTP method used to upload the file.
* _syncfileerr_: Alerts that there was an error while attempting to upload a file from the local share to the remote 
share.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being uploaded.
    * (String )_method_: The HTTP method being used to upload the file.
* _syncfileabort_: Transfer of a file to JCR share was cancelled prematurely.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being uploaded.
* _syncfileprogress_: Sent on a regular interval (approximately once every second) while a file is uploading.
  * (Object) _data_: Data for the event.
    * (String) _path_: The uploading file's path.
    * (Number) _read_: Number of bytes that have been uploaded so far. 
    * (Number) _total_: Total number of bytes to upload. **Note:** A value of 0 indicates that the total file size is
    unknown.
    * (Number) _rate_: The rate at which the file is uploading, in bytes per second.
    * (Number) _elapsed_: The amount of time that has elapsed since the upload started, in milliseconds.
