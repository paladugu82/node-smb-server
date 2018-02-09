# Digital Asset Management Backend

## Overview

Backend that displays a remote Digital Asset Management Repository's structure as the SMB mount's content. The primary
use-case of this backend is using AEM Assets as the SMB Server's data source.

This backend is a child class of the [JCR backend](../jcr), so it inherits all capabilities, configurations, 
events, and other entities. The primary difference between the two is that the DAM backend utilitizes [AEM's Assets
API](https://helpx.adobe.com/experience-manager/6-3/assets/using/mac-api-assets.html) to communicate with the remote
repository, where the JCR backend uses a JSON servlet.
