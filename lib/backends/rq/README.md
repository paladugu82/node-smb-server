[COMPONENTS]: #components
[RQ]: #request-queue
[CONFIG]: #configuration
[DAM]: ../dam
[RQP]: #request-queue-processor
[WORK]: #working-data
[JCR]: ../jcr
[CONFLICTS]: #conflict-handling
[OVERVIEW]: #overview
[CACHING]: #caching
[EVENTS]: #events
[DOWNLOAD]: #download-strategy
[FOLDERS]: #folder-handling
[DATES]: #file-dates
[RENAME]: #file-rename-considerations

# Request Queue Backend

## Contents

* [Overview][OVERVIEW]
* [Components][COMPONENTS]
* [Configuration][CONFIG]
* [Caching][CACHING]
* [Events][EVENTS]
* [Download Strategy][DOWNLOAD]
* [Folder Handling][FOLDERS]
* [Working Data][WORK]
* [File Dates][DATES]
* [Confict Handling][CONFLICTS]
* [File Rename Considerations][RENAME]

## Overview

The purpose of this backend is to provide an optimized file caching strategy, and to perform delayed writes back to
a remote repository. The original need that drove the creation of this backend is that the DAM backend's caches
were expiring too quickly, and attempting to upload particularly large files on `close` was taking too long and
forcing the SMB command to timeout. The upload delay provides the ability to transfer files in the background
without blocking other SMB commands.

In concept, the backend utilizes two "child" shares: a "remote" share and a "local" share. The remote share will be
initialized by the backend as a [DAM backend][DAM]. The local share can be any backend, and will be defined by
the [Configuration][CONFIG]. Most of the backend's `Share`, `Tree`, and `File` operations are a combination of the 
results retrieved from the two child shares. In most cases, information from one share will be higher priority than 
information from the other.

The priority system stems from how the backend behaves. The remote share is used to "download" files
to the local share, and is the target of the backend's delayed "uploads." The local share is used for all reads and
modifications of files, and is the source of the backend's delayed uploads. When working with an individual file, 
the backend will initially retrieve all of the file's information from the remote share. On the first read or write 
request, the backend will download the target file to the local share. From that point forward, the backend will start 
using the local share to retrieve information about that file.

The exception to this rule is folder lists, in which case the results of both shares are merged together so that the 
final list consists of files and folders that only exist in the remote share, and files and folders that only exist in 
the local share. If a file or folder exists in both shares then the local share's information will take priority.

When a file is modified through the SMB mount, the modifications are sent to the local share. After a delay, the backend
will upload the modified file from the local share to the remote share. Additional modifications to the file will reset
the delay, and changes any changes to the file while it's uploading will cancel the upload and reset the delay.

When a new file is added to the SMB mount, it is initially created only in the local share. Like file modifications,
the new file is uploaded to the remote share after a delay, and follows all the same rules.

## Components

The backend consists of the following individual pieces, in addition to the remote and local share described previously. 

#### Request Queue

After a file has been downloaded to the local share, all modifications to the file are "remembered" by the request 
queue. This includes writing to the file, moving the file, deleting the file, or creating a new file. Since the upload
of these changes is delayed, the queue will optimize all operations to a file that happen in a short period of time.

Take the following examples that happen in a short period of time:

* A file is created and then deleted. The entry for the file is removed.
* A file is created and modified. The modification entry is ignored, but the creation is preserved.
* A file is modified and then deleted. The original modification entry is discarded, and the delete entry is preserved.

These are just a few examples, but there are many more. The purpose of the optimization is to ensure that data transfer
to the remote share is minimized.

##### Request Queue Events

The request queue sends the following events.

* _requestchanged_: Sent when a request has been added to, updated in, or removed from the queue.
  * (Object) _data_: Data for the event.
    * (String) _path_: The server path of the file associated with the request.
    * [String] _method_: The currently queued http method of the request. This will not be present if `removed` is `true`.
    * [Number] _timestamp_: The timestamp when the request was last updated. This will not be present if `removed` is `true`.
    * [Boolean] _removed_: If present and `true`, signifies that the request was previously queued but was removed.
*_itemupdated_: Emitted when an existing entry is removed or updated.
  * (String) _path_: Server path of the request that was updated.
* _queuechanged_: Sent when one or more requests have been added to, updated in, or removed from the queue.
* _pathupdated_: All descendants of a given path were changed to a new path in, or were removed from, the queue.
  * (String) _oldPath_: The path whose entries descendants were changed or removed.

#### Request Queue Processor

This is a continually running process that periodically checks the entries in the [Request Queue][RQ]. If an entry in
the queue is old enough, the processor will execute the queued action using the remote share as the target. For example,
if the queued entry is a `delete` then the processor will delete the file from the remote share.

The frequency that the processor will check the request queue, and the "expiration" age of an entry can be defined in
the backend's [Configiration][CONFIG].

##### Request Queue Processor Events

These events are sent by the processor.

* _syncabort_: The processor has canceled an in-progress upload.
  * (Object) _data_: Data for the event.
    * (String) _path_: The server path of the file.
    * (String) _file_: The full local path of the file.
* _syncerr_: Sent if the processor encounters an error while uploading a file.
  * (Object) _data_: Data for the event.
    * (String) _path_: The server path of the file.
    * (String) _file_: The full local path of the file.
    * (String) _method_: HTTP method of the operation.
    * (String) _err_: The error that occurred.
* _syncend_: A file has finished processing a file successfully.
  * (Object) _data_: Data for the event.
    * (String) _path_: The server path of the file.
    * (String) _file_: The full local path of the file.
    * (String) _method_: HTTP method of the operation.
* _syncstart_: The processor began processing a file.
  * (Object) _data_: Data for the event.
    * (String) _path_: The server path of the file.
    * (String) _file_: The full local path of the file.
    * (String) _method_: HTTP method of the operation.
* _syncstart_: The processor began processing a file.
  * (Object) _data_: Data for the event.
    * (String) _path_: The server path of the file.
    * (String) _file_: The full local path of the file.
    * (Number) _read_: The number of bytes transferred so far. 
    * [Number] _total_: The total number of bytes to transfer. Will be missing or 0 if total size is not available. 
    * (Number) _rate_: The rate, in bytes per second, that the file is transferring. 
    * (Number) _elapsed_: The amount of time, in milliseconds, that have elapsed since the file started to transfer.
* _error_: The processor encountered a general error.
  * (Error) _err_: The error that occurred.
* _purged_: One or more files failed to transfer after the [configured][CONFIG] number of attempts.
  * (Array) _purged_: List of server paths.

## Configuration

The backend's configuration will be passed as-is to its remote backend when it's initialized, so it supports all
configurations of the [DAM Backend][DAM]. In addition to those configurations, the RQ backend supports the 
following:

* _expiration_: The amount of time, in milliseconds, that an entry must be in the [Request Queue][RQ] before the 
[Request Queue Processor][RQP] will send the entry to the remote share.
* _frequency_: The frequency, in milliseconds, that the [Request Queue Processor][RQP] will check the 
[Request Queue][RQ] for entries that are ready to process.
* _maxRetries_: The number of times the [Request Queue Processor][RQP] will attempt to process a failed entry in the 
[Request Queue][RQ] before giving up and removing the entry.
* _retryDelay_: The amount of time, in milliseconds, that the [Request Queue Processor][RQP] will wait before retrying
a failed [Request Queue][RQ] entry.
* _noUnicodeNormalize_: If `true`, the backend won't normalized unicode characters between the remote share and local
share. If `false`, the backend will normalize a file's path when downloading it to the local share, and convert it to its
original encoding when uploading to the remote share. Default: false.
* _cacheInfoOnly_: If `true`, the backend won't actually perform create, delete, or updates on the local version of a
file. It will only manage the file's [work data][WORK]. Default: false.
* _local_: Configuration of the share that the backend will use as its local share.
* _work_: Configuration of the share that the backend will use as its work share. The work share is where the backend
will store various [files and data][WORK] used to manage the backend's cache.

## Caching

The RQ backend uses a similar caching strategy as the [JCR][JCR] backend, with the primary difference that files in this 
backend's cache never expire. The exception to this rule is that the RQ backend will periodically check to see whether
or not a cached file has been modified in the remote share since the file was originally cached. If it has changed,
the backend will remove the file from the local share and download a fresh copy from the remote share.

However, the backend will first check to make sure the file in the cache hasn't been modified before it's deleted. If
there have been modifications, the cached file will _not_ be deleted and the file will be considered conflicting.
From there the backend's [Conflict Handling][CONFLICTS] strategy is applied.

## Events

The backend supports several of its own custom events, both outgoing and incoming. Outgoing events are forwarded b y the
server as `serverEvent`, where the events `eventData.event` is one of the event names below, and `eventData.data` is the 
event's extended data. Incoming events are passed to the share via the server's `processEvent` method. The backend also 
supports events from the [DAM backend][DAM].

#### Outgoing

These are the events that the backend sends as `serverEvent`.

* _cachesize_: Signifies that the size of the backend's local share has exceeded a maximum value.
  * (Object) _data_: Data for the event.
    * (Number) _maxCacheSize_: Maximum size, in bytes, that the cache exceeded.
    * (Number) _cacheSize_: Current size of the cache, in bytes.
* _requestqueueinit_: Sent when the backend has created the request queue instance that it will be using.
  * ([RequestQueue][RQ]) _rq_: The backend's request queue.
* _syncfilestart_: Emitted when the backend begins uploading a file from the local share to the remote share.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being uploaded.
    * (String) _file_: Full path to the local file being uploaded.
    * (String )_method_: The HTTP method being used to upload the file.
* _syncfileend_: Sent when the backend finishes uploading a file from the local share to the remote share.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the uploaded file.
    * (String) _file_: Full path to the uploaded local file.
    * (String) _method_: The HTTP method used to upload the file.
* _syncfileerr_: Alerts that there was an error while attempting to upload a file from the local share to the remote 
share.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being uploaded.
    * (String) _file_: Full path to the local file being uploaded.
    * (String )_method_: The HTTP method being used to upload the file.
* _syncerr_: There was a general error encountered during the upload process.
  * (Object) _data_: Data for the event.
    * (Error) _err_: Details about the error message.
* _syncpurged_: One or more files exceeded the maximum number of upload attempts and have been removed from the request
queue.
  * (Object) _data_: Data for the event.
    * (Array) _files_: A list of file paths that were removed.
* _syncfileabort_: Transfer of a file from the local share to the remote share was cancelled prematurely.
  * (Object) _data_: Data for the event.
    * (String) _path_: Server path to the file being uploaded.
    * (String) _file_: Full path to the local file being uploaded.
* _syncfileprogress_: Sent on a regular interval (approximately once every second) while a file is uploading.
  * (Object) _data_: Data for the event.
    * (String) _path_: The uploading file's path.
    * (String) _serverPath_: Full path to the file in the remote JCR. This is typically the file's full URL.
    * (String) _file_: Full path of where the file is being uploaded from the local file system.
    * (Number) _read_: Number of bytes that have been uploaded so far. 
    * (Number) _total_: Total number of bytes to upload. **Note:** A value of 0 indicates that the total file size is
    unknown.
    * (Number) _rate_: The rate at which the file is uploading, in bytes per second.
    * (Number) _elapsed_: The amount of time that has elapsed since the upload started, in milliseconds.
* _syncconflict_: Sent when a file is determined to be [in conflict][CONFLICTS].
  * (Object) _data_: Data for the event.
    * (String) _path_: Path of the file in conflict.
* _openasset_: Emitted when the backend receives instruction that one of its files needs to be opened.
  * (Object) _data_: Data for the event.
    * (String) _path_: Path to the file to open.

#### Incoming

The following events are handled by the backend when sent to the SMB Server's `processEvent` method. The list includes 
the name of the event and the information its expects as `processEvent`'s data parameter.

* _uploadasset_: Instructs the backend to upload a file from its local share to its remote share. The backend will
detect whether or not the file exists in the remote share and either create or update it accordingly.
  * (Object) _data_: Data for the event.
    * (String) _path_: The path of the file to upload.
    * (Boolean) _isDelete: If true, the backend will delete the file from the remote share.
* _downloadasset_: Tells the backend to download a file from the remote share to the local share. If the file already
exists in the local share, the backend will behave according to the instructions in the event data. The default behavior
is to simply return without doing anything.
  * (Object) _data_: Data for the event.
    * (String) _path_: Path of the file to download.
    * (Boolean) _force_: If true and the file exists, then the file will be removed and downloaded again.
  * (Function) _callback_: This event supports a callback, which will be invoked after the asset is has been downloaded.
  The callback will still be invoked if the asset was already downloaded previously.
    * (Error) _err_: Will be set to the error if one occurred.
* _checkcachesize_: When received, the backend will analyze the current size of the local share. If the size exceeds the
supplied maximum size then the backend will emit `cachesize`.
  * (Object) _data_: Data for the event.
    * (Number) _maxCacheSize_: The size, in bytes, that the cache should exceed before sending the event.
* _cancelupload_: Instructs the backend to cancel the in-progress transfer of a file from the local share to the remote
share. 
  * (Object) _data_: Data for the event.
    * (String) _path_: Path of the file.
* _isdownloaded_: Determines whether or not an asset has already been downloaded or not.
  * (Object) _data_: Data for the event.
    * (String) _path_: Path of the file.
  * (Function) _callback_: Will be invoked with the result of the operation
    * (Error) _err_: Will be set to the error if one occurred.
    * (Boolean) _isDownloaded_: Will be `true` if the asset is already downloaded, otherwise `false`.
    
## Download Strategy

The backend does several things to ensure that files are downloaded from the remote share to the local share correctly.

#### Prevent Concurrent Downloads

The download process uses a locking mechanism to block multiple commands from attempting to download the same file
more than once. For example, assume that two `read` commands occur withing a short period of time; the first command
initiates the download process, and the second command comes to the server while the file is still downloading. In this
case the second read command will wait until the download process finished before attempting to read the downloaded
file. If the download fails for the first command, then the command will return an error code and the second command 
will retry the download. Only one command can be downloading at a time, and all future commands for the same file will 
block until the download has finish.

It's worth noting that only commands that need to read or modify the file will block while it's downloading. All other
commands will continue using the remote share until the download finishes. 

#### Prevent Partial Downloads

There are many cases, such as lost network connections, that would cause a download to fail and result in an incomplete
or corrupt file. In order to prevent this from happening, all files are first downloaded to a temporary location. This
location will be in the operating system's designated temporary files directory, and will go through an automatic cleaning
process. Once a file downloads successfully, the process will move the newly downloaded file to its final path in the
local share.

## Folder Handling

Unlike files, changes to folders are immediately executed on both the local and remote share. For example, if a new
directory is created through the SMB Server's mount, then the directory is immediately created in the local
and remote share. Deleting or moving a directory behaves similarly.

The motivation for this behavior is that it greatly reduces the complexity of keeping the backend's shares in sync.
In addition, folder operations typically execute much faster than file operations, which involve data transfer 
over HTTP.

One unique case that provides challenges involves directories with names that indicate that the directory is temporary.
For example, if the directory name begins with a period. In the case where a directory is renamed from a permanent
name to a temporary name, the backend does _not_ perform this operation in the remote share because it would involve
recursively removing all children of the directory from the remote share. Like the [JCR Share][JCR], this backend does
not store temporary files or directories in the remote share. Inversely, renaming a directory from a temporary name
to a permanent name does trigger a change in the remote share because all children of the directory would need to be
uploaded to the remote share. These are two cases that can cause the two shares to get out of sync.

## Working Data

The backend uses special files to store information about the state of each file in its local share; these files are
collectively known as "working data." The exact location of these files is determined by the [Configuration][CONFIG].
The working directory will contain a folder structure mirrored after the local share's structure. Inside each directory
will be a `.aem` folder, inside which will be files that mirror the files in the corresponding directory of the local
share; the only difference being that these working files will have a `.json` extension.

Take the following local share structure:

```
+ directory1
-+ directory2
--- file2.jpg
--- file3.jpg
-- file1.jpg
```

Given this structure, the working directory will be:

```
+ directory1
-+ directory2
--+ .aem
---- file2.jpg.json
---- file3.jpg.json
-+ .aem
--- file1.jpg.json
```

Note the addition of the `.aem` directory and files with a `.json` extension.

#### Work File Contents

Each `.json` file contains the following information about the state of the local file.

* _local_: Information about the local share's version of the file.
  * _lastModified_: The last modified timestamp of the local file at the time the work file was created.
* _created_: `true` if the file is newly created in the local share and doesn't exist in the remote share yet.
* _refreshed_: `true` if the work file's information has changed due to a refresh of the file's information.
* _synced_: Timestamp of the when the work file was last updated.
* _remote_: Information about the remote share's version of the file. This information may or may not be present.
  * _lastModified_: The last modified timestamp of the remote file at the time the work file was created.
  * _created_: The created timestamp of the remote file at the time the work file was created.

## File Dates

One exception to the rule that the local share's file information will take priority over the remote version is the last
modified date and created date of a file. In this case the backend follows a specific set of rules.

* Created Date
  * Will always use the remote created date if available, as long as the remote created date is older than the local
  created date.
  * Because of the created date's rules, there exists a case where the create date of a file can change. Take the
  following sequence:
    * A new file is created on the SMB mount, which creates a new file in the local share. The file's creation date will
    be the creation date of the local file.
    * The newly created file is transferred to the remote share after a delay. The local and remote created dates are
    different, but the creation date continues to be the local file's date because it's older.
    * Due to one of several potential reasons, the local version of the file is removed (cache clear, new remote version)
    * The file's created date will change to the remote file's created date, since it is now older than the local file's.
* Modified Date
  * The file will use the remote version's modified date if these conditions are met:
    * A remote version of the file exists.
    * The local version of the file has not been modified since it was initially downloaded.
    * The [work data][WORK] is not flagged as being refreshed (meaning the file has been modified and re-uploaded since
    it was intially downloaded).
  * In all other cases the backend will use the local file's last modified.

## Conflict Handling

The backend will do its best to keep files synchronized between the remote and local share, but there will still be
times when the files become out of sync. Two users changing the same file at the same time, failed uploads, and renaming
temporary folders are all cases where this can happen.

The state of the file determines what the backend will do.

#### When Uploading

If a file being uploaded has changed both locally and remotely, the backend will simply continue the upload and overwrite
the remote version. AEM Assets provides a version history, and it will be left up to the user to manage the conflict
through that user interface.

#### When Downloading

If a file has changed remotely, the backend will perform several checks before removing the local version and replacing
it with a fresh copy of the remote version. If the local file has changed since it was last downloaded, the backend will
check to see if the file is queued for upload. If it is, the download won't happen and the backend will proceed with
it's upload conflict handling strategy. If the file is _not_ queued then the backend won't remove the file in order to
avoid losing the user's changes; it will also send the `syncconflict` event.

Once a local file is in conflict, it will remain that way and won't be touched unless it's uploaded or forcibly removed.
It can be uploaded "naturally" if the user modifies the file. Alternatively, utilizing the `uploadasset` or 
`downloadasset` (with force flag) events will resolve the conflict.

## File Rename Considerations

To help simplify the complexity of renaming - or moving - files, the backend does not perform true moves on the remote
share. Instead, it breaks the operation into two: delete the old path, create the new file path. This has some 
side-effects:

* When a file is renamed through the SMB server mount, it will lose its history in AEM Assets.
* The full operation will take longer to complete because the backend will need to upload the entire file instead of
just sending the command for a move operation.
