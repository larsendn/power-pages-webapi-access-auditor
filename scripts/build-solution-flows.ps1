param(
    [string]$SolutionSource = (Join-Path $PSScriptRoot "..\solution\PowerPagesWebApiFieldsAuditor\src"),
    [string]$Version = "1.6.0.20"
)

$ErrorActionPreference = "Stop"

$connectionLogicalName = "ppwfa_sharedcommondataserviceforapps"
$connectorName = "shared_commondataserviceforapps"
$connectorId = "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps"
$managementConnectionLogicalName = "ppwfa_sharedflowmanagement"
$managementConnectorName = "shared_flowmanagement"
$managementConnectorId = "/providers/Microsoft.PowerApps/apis/shared_flowmanagement"
$workflowIds = [ordered]@{
    Environments = "37a35bd1-0bb5-47dd-b5ec-b09265243387"
    Discover = "eb3a493a-e784-4dcd-a8df-1764c7c685a1"
    Retrieve = "90b27521-560a-4a72-a8d2-19640610f7af"
    CodeFile = "f6c3f065-8665-4e54-bad6-902697fb86b5"
    Apply = "7a44b75d-6388-4e32-8849-8ce40acb2a3a"
    Restore = "db39e95e-892b-49c9-ac6a-082f224ec19b"
    Verify = "3b931685-ce4f-45b1-9f9b-f45df463f34b"
}

function New-InputProperty {
    param([string]$Title)

    return [ordered]@{
        title = $Title
        type = "string"
        description = $Title
        "x-ms-content-hint" = "TEXT"
        "x-ms-dynamically-added" = $true
    }
}

function New-OutputProperty {
    param([string]$Title)

    return [ordered]@{
        title = $Title
        type = "string"
        "x-ms-dynamically-added" = $true
    }
}

function New-Trigger {
    param([string[]]$Inputs = @())

    $properties = [ordered]@{}
    foreach ($inputName in $Inputs) {
        $properties[$inputName] = New-InputProperty $inputName
    }

    return [ordered]@{
        manual = [ordered]@{
            type = "Request"
            kind = "PowerAppV2"
            inputs = [ordered]@{
                schema = [ordered]@{
                    type = "object"
                    properties = $properties
                    required = $Inputs
                }
            }
        }
    }
}

function New-DataverseAction {
    param(
        [string]$OperationId,
        $Parameters,
        $RunAfter = ([ordered]@{})
    )

    if ($Parameters.entityName -and $Parameters.entityName -is [string] -and -not $Parameters.entityName.StartsWith("@")) {
        $entityName = $Parameters.entityName
        $splitAt = [Math]::Max(1, [Math]::Floor($entityName.Length / 2))
        $Parameters.entityName = "@concat('$($entityName.Substring(0, $splitAt))','$($entityName.Substring($splitAt))')"
    }

    return New-ConnectorAction -ConnectorName $connectorName -ConnectorId $connectorId -OperationId $OperationId -Parameters $Parameters -RunAfter $RunAfter
}

function New-ConnectorAction {
    param(
        [string]$ConnectorName,
        [string]$ConnectorId,
        [string]$OperationId,
        $Parameters,
        $RunAfter = ([ordered]@{})
    )

    return [ordered]@{
        runAfter = $RunAfter
        type = "OpenApiConnection"
        inputs = [ordered]@{
            host = [ordered]@{
                connectionName = $ConnectorName
                operationId = $OperationId
                apiId = $ConnectorId
            }
            parameters = $Parameters
            authentication = [ordered]@{
                type = "Raw"
                value = "@json(decodeBase64(triggerOutputs().headers['X-MS-APIM-Tokens']))['`$ConnectionKey']"
            }
        }
    }
}

function New-ResponseAction {
    param(
        $Body,
        $RunAfter = ([ordered]@{})
    )

    $properties = [ordered]@{}
    foreach ($name in $Body.Keys) {
        $properties[$name] = New-OutputProperty $name
    }

    return [ordered]@{
        runAfter = $RunAfter
        type = "Response"
        kind = "PowerApp"
        inputs = [ordered]@{
            statusCode = 200
            body = $Body
            schema = [ordered]@{
                type = "object"
                properties = $properties
            }
        }
    }
}

function New-Definition {
    param(
        $Triggers,
        $Actions,
        [switch]$IncludeFlowManagement
    )

    $connectionReferences = [ordered]@{
        $connectorName = [ordered]@{
            runtimeSource = "embedded"
            connection = [ordered]@{
                connectionReferenceLogicalName = $connectionLogicalName
            }
            api = [ordered]@{ name = $connectorName }
        }
    }
    if ($IncludeFlowManagement) {
        $connectionReferences[$managementConnectorName] = [ordered]@{
            runtimeSource = "embedded"
            connection = [ordered]@{
                connectionReferenceLogicalName = $managementConnectionLogicalName
            }
            api = [ordered]@{ name = $managementConnectorName }
        }
    }

    return [ordered]@{
        properties = [ordered]@{
            connectionReferences = $connectionReferences
            definition = [ordered]@{
                '$schema' = "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#"
                contentVersion = "1.0.0.0"
                parameters = [ordered]@{
                    '$connections' = [ordered]@{ defaultValue = [ordered]@{}; type = "Object" }
                    '$authentication' = [ordered]@{ defaultValue = [ordered]@{}; type = "SecureObject" }
                }
                triggers = $Triggers
                actions = $Actions
                outputs = [ordered]@{}
            }
            templateName = ""
        }
        schemaVersion = "1.0.0.0"
    }
}

function Add-ListAction {
    param(
        $Actions,
        [string]$Name,
        [string]$EntityName,
        [string]$Select,
        [string]$Filter = "",
        [string]$Organization = "",
        [string]$Expand = ""
    )

    $parameters = [ordered]@{
        entityName = $EntityName
        '$select' = $Select
    }
    if ($Filter) {
        $parameters['$filter'] = $Filter
    }
    if ($Expand) {
        $parameters['$expand'] = $Expand
    }
    $operationId = "ListRecords"
    if ($Organization) {
        $parameters = [ordered]@{ organization = $Organization } + $parameters
        $operationId = "ListRecordsWithOrganization"
    }
    $Actions[$Name] = New-DataverseAction -OperationId $operationId -Parameters $parameters
}

function New-WorkflowMetadata {
    param(
        [string]$Id,
        [string]$Name,
        [string]$FileName
    )

    return @"
<?xml version="1.0" encoding="utf-8"?>
<Workflow WorkflowId="{$Id}" Name="$Name" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <JsonFileName>/Workflows/$FileName</JsonFileName>
  <Type>1</Type>
  <Subprocess>0</Subprocess>
  <Category>5</Category>
  <Mode>0</Mode>
  <Scope>4</Scope>
  <OnDemand>0</OnDemand>
  <TriggerOnCreate>0</TriggerOnCreate>
  <TriggerOnDelete>0</TriggerOnDelete>
  <AsyncAutodelete>0</AsyncAutodelete>
  <SyncWorkflowLogOnFailure>0</SyncWorkflowLogOnFailure>
  <StateCode>1</StateCode>
  <StatusCode>2</StatusCode>
  <RunAs>1</RunAs>
  <IsTransacted>1</IsTransacted>
  <IntroducedVersion>1.0.1.0</IntroducedVersion>
  <IsCustomizable>1</IsCustomizable>
  <BusinessProcessType>0</BusinessProcessType>
  <IsCustomProcessingStepAllowedForOtherPublishers>1</IsCustomProcessingStepAllowedForOtherPublishers>
  <ModernFlowType>0</ModernFlowType>
  <PrimaryEntity>none</PrimaryEntity>
  <LocalizedNames>
    <LocalizedName languagecode="1033" description="$Name" />
  </LocalizedNames>
</Workflow>
"@
}

$flows = [ordered]@{}

$environmentActions = [ordered]@{
    List_Accessible_Environments = New-ConnectorAction -ConnectorName $managementConnectorName -ConnectorId $managementConnectorId -OperationId "ListUserEnvironments" -Parameters ([ordered]@{})
}
$environmentActions["Select_Environment_Summaries"] = [ordered]@{
    runAfter = [ordered]@{ List_Accessible_Environments = @("Succeeded") }
    type = "Select"
    inputs = [ordered]@{
        from = "@body('List_Accessible_Environments')?['value']"
        select = [ordered]@{
            name = "@item()?['name']"
            displayName = "@item()?['properties']?['displayName']"
            environmentUrl = "@item()?['properties']?['linkedEnvironmentMetadata']?['instanceUrl']"
            environmentSku = "@item()?['properties']?['environmentSku']"
            environmentType = "@item()?['properties']?['environmentType']"
        }
    }
}
$environmentActions["Respond_to_Power_App"] = New-ResponseAction -RunAfter ([ordered]@{
    Select_Environment_Summaries = @("Succeeded")
}) -Body ([ordered]@{
    environmentsJson = "@{string(body('Select_Environment_Summaries'))}"
})
$flows.Environments = [ordered]@{
    Name = "PPWFA - Discover Environments"
    Slug = "PPWFADiscoverEnvironments"
    Definition = New-Definition (New-Trigger) $environmentActions -IncludeFlowManagement
}

$discoverActions = [ordered]@{}
Add-ListAction $discoverActions "List_Enhanced_And_Code_Sites" "powerpagesites" "powerpagesiteid,name,primarydomainname,statecode,statuscode" -Organization "@triggerBody()?['targetEnvironment']"
Add-ListAction $discoverActions "List_Standard_Sites" "adx_websites" "adx_websiteid,adx_name,adx_primarydomainname,statecode,statuscode" -Organization "@triggerBody()?['targetEnvironment']"
Add-ListAction $discoverActions "List_Modern_Sites" "mspp_websites" "mspp_websiteid,mspp_name,mspp_primarydomainname,statecode,statuscode" -Organization "@triggerBody()?['targetEnvironment']"
$discoverActions["Respond_to_Power_App"] = New-ResponseAction -RunAfter ([ordered]@{
    List_Enhanced_And_Code_Sites = @("Succeeded", "Failed", "TimedOut", "Skipped")
    List_Standard_Sites = @("Succeeded", "Failed", "TimedOut", "Skipped")
    List_Modern_Sites = @("Succeeded", "Failed", "TimedOut", "Skipped")
}) -Body ([ordered]@{
    enhancedAndCodeSitesJson = "@{if(equals(actions('List_Enhanced_And_Code_Sites')?['status'],'Succeeded'),string(body('List_Enhanced_And_Code_Sites')?['value']),'[]')}"
    standardSitesJson = "@{if(equals(actions('List_Standard_Sites')?['status'],'Succeeded'),string(body('List_Standard_Sites')?['value']),'[]')}"
    modernSitesJson = "@{if(equals(actions('List_Modern_Sites')?['status'],'Succeeded'),string(body('List_Modern_Sites')?['value']),'[]')}"
    enhancedStatus = "@{actions('List_Enhanced_And_Code_Sites')?['status']}"
    enhancedErrorCode = "@{coalesce(actions('List_Enhanced_And_Code_Sites')?['outputs']?['body']?['error']?['code'],'')}"
    enhancedErrorMessage = "@{coalesce(actions('List_Enhanced_And_Code_Sites')?['outputs']?['body']?['error']?['message'],'')}"
    standardStatus = "@{actions('List_Standard_Sites')?['status']}"
    standardErrorCode = "@{coalesce(actions('List_Standard_Sites')?['outputs']?['body']?['error']?['code'],'')}"
    standardErrorMessage = "@{coalesce(actions('List_Standard_Sites')?['outputs']?['body']?['error']?['message'],'')}"
    modernStatus = "@{actions('List_Modern_Sites')?['status']}"
    modernErrorCode = "@{coalesce(actions('List_Modern_Sites')?['outputs']?['body']?['error']?['code'],'')}"
    modernErrorMessage = "@{coalesce(actions('List_Modern_Sites')?['outputs']?['body']?['error']?['message'],'')}"
})
$flows.Discover = [ordered]@{
    Name = "PPWFA - Discover Sites"
    Slug = "PPWFADiscoverSites"
    Definition = New-Definition (New-Trigger @("targetEnvironment")) $discoverActions
}

$retrieveActions = [ordered]@{}
$enhancedFilter = "_powerpagesiteid_value eq @{triggerBody()?['siteId']}"
$standardFilter = "_adx_websiteid_value eq @{triggerBody()?['siteId']}"
$modernFilter = "_mspp_websiteid_value eq @{triggerBody()?['siteId']}"
Add-ListAction $retrieveActions "List_Enhanced_Components" "powerpagecomponents" "powerpagecomponentid,name,powerpagecomponenttype,content" $enhancedFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Settings" "adx_sitesettings" "adx_sitesettingid,adx_name,adx_value" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Web_Pages" "adx_webpages" "adx_webpageid,adx_name,adx_partialurl,adx_copy,adx_customjavascript,adx_customcss" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Web_Templates" "adx_webtemplates" "adx_webtemplateid,adx_name,adx_source" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Basic_Forms" "adx_entityforms" "adx_entityformid,adx_name,adx_registerstartupscript" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Multistep_Forms" "adx_webforms" "adx_webformid,adx_name" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Multistep_Form_Steps" "adx_webformsteps" "adx_webformstepid,adx_name,adx_registerstartupscript,_adx_webform_value" -Organization "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Content_Snippets" "adx_contentsnippets" "adx_contentsnippetid,adx_name,adx_value" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Web_Files" "adx_webfiles" "adx_webfileid,adx_name,adx_partialurl" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Table_Permissions" "adx_entitypermissions" "adx_entitypermissionid,adx_entitylogicalname,adx_entityname,adx_scope,adx_read,adx_write,adx_create,adx_delete,adx_append,adx_appendto,_adx_parententitypermission_value" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Web_Roles" "adx_webroles" "adx_webroleid,adx_name,adx_anonymoususersrole" $standardFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Standard_Permission_Roles" "adx_entitypermission_webroleset" "adx_entitypermissionid,adx_webroleid" -Organization "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Settings" "mspp_sitesettings" "mspp_sitesettingid,mspp_name,mspp_value" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Web_Pages" "mspp_webpages" "mspp_webpageid,mspp_name,mspp_partialurl,mspp_copy,mspp_customjavascript,mspp_customcss" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Web_Templates" "mspp_webtemplates" "mspp_webtemplateid,mspp_name,mspp_source" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Basic_Forms" "mspp_entityforms" "mspp_entityformid,mspp_name,mspp_registerstartupscript" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Multistep_Forms" "mspp_webforms" "mspp_webformid,mspp_name" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Multistep_Form_Steps" "mspp_webformsteps" "mspp_webformstepid,mspp_name,mspp_registerstartupscript,_mspp_webform_value" -Organization "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Content_Snippets" "mspp_contentsnippets" "mspp_contentsnippetid,mspp_name,mspp_value" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Web_Files" "mspp_webfiles" "mspp_webfileid,mspp_name,mspp_partialurl" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Table_Permissions" "mspp_entitypermissions" "mspp_entitypermissionid,mspp_entitylogicalname,mspp_entityname,mspp_scope,mspp_read,mspp_write,mspp_create,mspp_delete,mspp_append,mspp_appendto,_mspp_parententitypermission_value" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Web_Roles" "mspp_webroles" "mspp_webroleid,mspp_name,mspp_anonymoususersrole" $modernFilter "@triggerBody()?['targetEnvironment']"
Add-ListAction $retrieveActions "List_Modern_Permission_Roles" "mspp_entitypermission_webroleset" "mspp_entitypermissionid,mspp_webroleid" -Organization "@triggerBody()?['targetEnvironment']"
$retrieveRunAfter = [ordered]@{}
foreach ($actionName in @($retrieveActions.Keys)) {
    $retrieveRunAfter[$actionName] = @("Succeeded", "Failed", "TimedOut", "Skipped")
}
$retrieveDiagnosticArguments = @($retrieveActions.Keys | ForEach-Object { "'$($_)=',actions('$($_)')?['status'],';'" })
$retrieveDiagnosticsExpression = "@{concat($($retrieveDiagnosticArguments -join ','))}"
$retrieveActions["Respond_to_Power_App"] = New-ResponseAction -RunAfter $retrieveRunAfter -Body ([ordered]@{
    retrievalDiagnostics = $retrieveDiagnosticsExpression
    enhancedComponentsJson = "@{if(equals(actions('List_Enhanced_Components')?['status'],'Succeeded'),string(body('List_Enhanced_Components')?['value']),'[]')}"
    standardSettingsJson = "@{if(equals(actions('List_Standard_Settings')?['status'],'Succeeded'),string(body('List_Standard_Settings')?['value']),'[]')}"
    standardWebPagesJson = "@{if(equals(actions('List_Standard_Web_Pages')?['status'],'Succeeded'),string(body('List_Standard_Web_Pages')?['value']),'[]')}"
    standardWebTemplatesJson = "@{if(equals(actions('List_Standard_Web_Templates')?['status'],'Succeeded'),string(body('List_Standard_Web_Templates')?['value']),'[]')}"
    standardBasicFormsJson = "@{if(equals(actions('List_Standard_Basic_Forms')?['status'],'Succeeded'),string(body('List_Standard_Basic_Forms')?['value']),'[]')}"
    standardMultistepFormsJson = "@{if(equals(actions('List_Standard_Multistep_Forms')?['status'],'Succeeded'),string(body('List_Standard_Multistep_Forms')?['value']),'[]')}"
    standardMultistepFormStepsJson = "@{if(equals(actions('List_Standard_Multistep_Form_Steps')?['status'],'Succeeded'),string(body('List_Standard_Multistep_Form_Steps')?['value']),'[]')}"
    standardContentSnippetsJson = "@{if(equals(actions('List_Standard_Content_Snippets')?['status'],'Succeeded'),string(body('List_Standard_Content_Snippets')?['value']),'[]')}"
    standardWebFilesJson = "@{if(equals(actions('List_Standard_Web_Files')?['status'],'Succeeded'),string(body('List_Standard_Web_Files')?['value']),'[]')}"
    standardPermissionsJson = "@{if(equals(actions('List_Standard_Table_Permissions')?['status'],'Succeeded'),string(body('List_Standard_Table_Permissions')?['value']),'[]')}"
    standardRolesJson = "@{if(equals(actions('List_Standard_Web_Roles')?['status'],'Succeeded'),string(body('List_Standard_Web_Roles')?['value']),'[]')}"
    standardPermissionRolesJson = "@{if(equals(actions('List_Standard_Permission_Roles')?['status'],'Succeeded'),string(body('List_Standard_Permission_Roles')?['value']),'[]')}"
    modernSettingsJson = "@{if(equals(actions('List_Modern_Settings')?['status'],'Succeeded'),string(body('List_Modern_Settings')?['value']),'[]')}"
    modernWebPagesJson = "@{if(equals(actions('List_Modern_Web_Pages')?['status'],'Succeeded'),string(body('List_Modern_Web_Pages')?['value']),'[]')}"
    modernWebTemplatesJson = "@{if(equals(actions('List_Modern_Web_Templates')?['status'],'Succeeded'),string(body('List_Modern_Web_Templates')?['value']),'[]')}"
    modernBasicFormsJson = "@{if(equals(actions('List_Modern_Basic_Forms')?['status'],'Succeeded'),string(body('List_Modern_Basic_Forms')?['value']),'[]')}"
    modernMultistepFormsJson = "@{if(equals(actions('List_Modern_Multistep_Forms')?['status'],'Succeeded'),string(body('List_Modern_Multistep_Forms')?['value']),'[]')}"
    modernMultistepFormStepsJson = "@{if(equals(actions('List_Modern_Multistep_Form_Steps')?['status'],'Succeeded'),string(body('List_Modern_Multistep_Form_Steps')?['value']),'[]')}"
    modernContentSnippetsJson = "@{if(equals(actions('List_Modern_Content_Snippets')?['status'],'Succeeded'),string(body('List_Modern_Content_Snippets')?['value']),'[]')}"
    modernWebFilesJson = "@{if(equals(actions('List_Modern_Web_Files')?['status'],'Succeeded'),string(body('List_Modern_Web_Files')?['value']),'[]')}"
    modernPermissionsJson = "@{if(equals(actions('List_Modern_Table_Permissions')?['status'],'Succeeded'),string(body('List_Modern_Table_Permissions')?['value']),'[]')}"
    modernRolesJson = "@{if(equals(actions('List_Modern_Web_Roles')?['status'],'Succeeded'),string(body('List_Modern_Web_Roles')?['value']),'[]')}"
    modernPermissionRolesJson = "@{if(equals(actions('List_Modern_Permission_Roles')?['status'],'Succeeded'),string(body('List_Modern_Permission_Roles')?['value']),'[]')}"
})
$flows.Retrieve = [ordered]@{
    Name = "PPWFA - Retrieve Site Configuration"
    Slug = "PPWFARetrieveSiteConfiguration"
    Definition = New-Definition (New-Trigger @("targetEnvironment", "siteId", "modelKind")) $retrieveActions
}

$codeFileActions = [ordered]@{}
$codeFileActions["Is_Standard_Model"] = [ordered]@{
    runAfter = [ordered]@{}
    type = "If"
    expression = [ordered]@{ or = @(
        [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "standard") },
        [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "modern") }
    ) }
    actions = [ordered]@{
        List_Standard_Web_File_Annotations = New-DataverseAction "ListRecordsWithOrganization" ([ordered]@{
            organization = "@triggerBody()?['targetEnvironment']"
            entityName = "annotations"
            '$select' = "annotationid,filename,documentbody,mimetype"
            '$filter' = "_objectid_value eq @{triggerBody()?['fileId']} and isdocument eq true"
        })
        Respond_Standard_Code_File = New-ResponseAction -RunAfter ([ordered]@{ List_Standard_Web_File_Annotations = @("Succeeded") }) -Body ([ordered]@{
            filesJson = "@{string(body('List_Standard_Web_File_Annotations')?['value'])}"
        })
    }
    else = [ordered]@{
        actions = [ordered]@{
            Download_Enhanced_Web_File = New-DataverseAction "GetEntityFileImageFieldContentWithOrganization" ([ordered]@{
                organization = "@triggerBody()?['targetEnvironment']"
                entityName = "powerpagecomponents"
                recordId = "@triggerBody()?['fileId']"
                fileImageFieldName = "filecontent"
                Range = "bytes=0-"
            })
            Respond_Enhanced_Code_File = New-ResponseAction -RunAfter ([ordered]@{ Download_Enhanced_Web_File = @("Succeeded") }) -Body ([ordered]@{
                filesJson = "@{concat('[{`"filename`":`"',replace(triggerBody()?['fileName'],'`"',''), '`",`"documentbody`":`"',base64(body('Download_Enhanced_Web_File')),'`"}]')}"
            })
        }
    }
}
$flows.CodeFile = [ordered]@{
    Name = "PPWFA - Retrieve Code File"
    Slug = "PPWFARetrieveCodeFile"
    Definition = New-Definition (New-Trigger @("targetEnvironment", "modelKind", "fileId", "fileName")) $codeFileActions
}

$storedNameFunction = "if(equals(toLower(triggerBody()?['modelKind']),'standard'),body('Get_Standard_Setting')?['adx_name'],if(equals(toLower(triggerBody()?['modelKind']),'modern'),body('Get_Modern_Setting')?['mspp_name'],json(body('Get_Enhanced_Setting')?['content'])?['name']))"
$storedValueFunction = "if(equals(toLower(triggerBody()?['modelKind']),'standard'),body('Get_Standard_Setting')?['adx_value'],if(equals(toLower(triggerBody()?['modelKind']),'modern'),body('Get_Modern_Setting')?['mspp_value'],json(body('Get_Enhanced_Setting')?['content'])?['value']))"
$storedNameExpression = "@$storedNameFunction"
$storedValueExpression = "@$storedValueFunction"
$scopeGuardExpression = "@and(equals(toLower(triggerBody()?['settingName']),toLower($storedNameFunction)),equals(length(split(triggerBody()?['settingName'],'/')),3),equals(toLower(first(split(triggerBody()?['settingName'],'/'))),'webapi'),equals(toLower(last(split(triggerBody()?['settingName'],'/'))),'fields'),contains(split(replace($storedValueFunction,' ',''),','),'*'),not(contains(triggerBody()?['approvedValue'],'*')),greater(length(trim(triggerBody()?['approvedValue'])),0))"

$applyActions = [ordered]@{}
$applyActions["Is_Standard_Model"] = [ordered]@{
    runAfter = [ordered]@{}
    type = "If"
    expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "standard") }
    actions = [ordered]@{
        Get_Standard_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "adx_sitesettings"; recordId = "@triggerBody()?['settingId']" })
    }
    else = [ordered]@{
        actions = [ordered]@{
            Is_Modern_Setting_Read = [ordered]@{
                runAfter = [ordered]@{}
                type = "If"
                expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "modern") }
                actions = [ordered]@{
                    Get_Modern_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "mspp_sitesettings"; recordId = "@triggerBody()?['settingId']" })
                }
                else = [ordered]@{
                    actions = [ordered]@{
                        Get_Enhanced_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "powerpagecomponents"; recordId = "@triggerBody()?['settingId']" })
                    }
                }
            }
        }
    }
}
$applyActions["Validate_Wildcard_Field_Setting"] = [ordered]@{
    runAfter = [ordered]@{ Is_Standard_Model = @("Succeeded") }
    type = "If"
    expression = $scopeGuardExpression
    actions = [ordered]@{
        Apply_By_Model = [ordered]@{
            runAfter = [ordered]@{}
            type = "If"
            expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "standard") }
            actions = [ordered]@{
                Update_Standard_Setting = New-DataverseAction "UpdateOnlyRecordWithOrganization" ([ordered]@{
                    organization = "@triggerBody()?['targetEnvironment']"
                    entityName = "adx_sitesettings"
                    recordId = "@triggerBody()?['settingId']"
                    item = [ordered]@{ adx_value = "@triggerBody()?['approvedValue']" }
                })
            }
            else = [ordered]@{
                actions = [ordered]@{
                    Is_Modern_Setting_Update = [ordered]@{
                        runAfter = [ordered]@{}
                        type = "If"
                        expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "modern") }
                        actions = [ordered]@{
                            Update_Modern_Setting = New-DataverseAction "UpdateOnlyRecordWithOrganization" ([ordered]@{
                                organization = "@triggerBody()?['targetEnvironment']"
                                entityName = "mspp_sitesettings"
                                recordId = "@triggerBody()?['settingId']"
                                item = [ordered]@{ mspp_value = "@triggerBody()?['approvedValue']" }
                            })
                        }
                        else = [ordered]@{
                            actions = [ordered]@{
                                Update_Enhanced_Setting = New-DataverseAction "UpdateOnlyRecordWithOrganization" ([ordered]@{
                                    organization = "@triggerBody()?['targetEnvironment']"
                                    entityName = "powerpagecomponents"
                                    recordId = "@triggerBody()?['settingId']"
                                    item = [ordered]@{ content = "@string(setProperty(json(body('Get_Enhanced_Setting')?['content']),'value',triggerBody()?['approvedValue']))" }
                                })
                            }
                        }
                    }
                }
            }
        }
        Respond_Applied = New-ResponseAction -RunAfter ([ordered]@{ Apply_By_Model = @("Succeeded") }) -Body ([ordered]@{
            status = "Applied"
            settingId = "@triggerBody()?['settingId']"
            appliedValue = "@triggerBody()?['approvedValue']"
        })
    }
    else = [ordered]@{
        actions = [ordered]@{
            Respond_Blocked = New-ResponseAction -Body ([ordered]@{
                status = "Blocked"
                settingId = "@triggerBody()?['settingId']"
                appliedValue = ""
            })
        }
    }
}
$flows.Apply = [ordered]@{
    Name = "PPWFA - Apply Approved Fields"
    Slug = "PPWFAApplyApprovedFields"
    Definition = New-Definition (New-Trigger @("targetEnvironment", "modelKind", "settingId", "settingName", "approvedValue")) $applyActions
}

$restoreGuardExpression = "@and(equals(toLower(triggerBody()?['settingName']),toLower($storedNameFunction)),equals(length(split(triggerBody()?['settingName'],'/')),3),equals(toLower(first(split(triggerBody()?['settingName'],'/'))),'webapi'),equals(toLower(last(split(triggerBody()?['settingName'],'/'))),'fields'),equals(string($storedValueFunction),triggerBody()?['expectedCurrentValue']),not(contains(triggerBody()?['expectedCurrentValue'],'*')),contains(split(replace(triggerBody()?['restoreValue'],' ',''),','),'*'))"
$restoreActions = [ordered]@{}
$restoreActions["Is_Standard_Model"] = [ordered]@{
    runAfter = [ordered]@{}
    type = "If"
    expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "standard") }
    actions = [ordered]@{
        Get_Standard_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "adx_sitesettings"; recordId = "@triggerBody()?['settingId']" })
    }
    else = [ordered]@{
        actions = [ordered]@{
            Is_Modern_Setting_Read = [ordered]@{
                runAfter = [ordered]@{}
                type = "If"
                expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "modern") }
                actions = [ordered]@{
                    Get_Modern_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "mspp_sitesettings"; recordId = "@triggerBody()?['settingId']" })
                }
                else = [ordered]@{
                    actions = [ordered]@{
                        Get_Enhanced_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "powerpagecomponents"; recordId = "@triggerBody()?['settingId']" })
                    }
                }
            }
        }
    }
}
$restoreActions["Validate_Restore_Request"] = [ordered]@{
    runAfter = [ordered]@{ Is_Standard_Model = @("Succeeded") }
    type = "If"
    expression = $restoreGuardExpression
    actions = [ordered]@{
        Restore_By_Model = [ordered]@{
            runAfter = [ordered]@{}
            type = "If"
            expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "standard") }
            actions = [ordered]@{
                Restore_Standard_Setting = New-DataverseAction "UpdateOnlyRecordWithOrganization" ([ordered]@{
                    organization = "@triggerBody()?['targetEnvironment']"
                    entityName = "adx_sitesettings"
                    recordId = "@triggerBody()?['settingId']"
                    item = [ordered]@{ adx_value = "@triggerBody()?['restoreValue']" }
                })
            }
            else = [ordered]@{
                actions = [ordered]@{
                    Is_Modern_Setting_Restore = [ordered]@{
                        runAfter = [ordered]@{}
                        type = "If"
                        expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "modern") }
                        actions = [ordered]@{
                            Restore_Modern_Setting = New-DataverseAction "UpdateOnlyRecordWithOrganization" ([ordered]@{
                                organization = "@triggerBody()?['targetEnvironment']"
                                entityName = "mspp_sitesettings"
                                recordId = "@triggerBody()?['settingId']"
                                item = [ordered]@{ mspp_value = "@triggerBody()?['restoreValue']" }
                            })
                        }
                        else = [ordered]@{
                            actions = [ordered]@{
                                Restore_Enhanced_Setting = New-DataverseAction "UpdateOnlyRecordWithOrganization" ([ordered]@{
                                    organization = "@triggerBody()?['targetEnvironment']"
                                    entityName = "powerpagecomponents"
                                    recordId = "@triggerBody()?['settingId']"
                                    item = [ordered]@{ content = "@string(setProperty(json(body('Get_Enhanced_Setting')?['content']),'value',triggerBody()?['restoreValue']))" }
                                })
                            }
                        }
                    }
                }
            }
        }
        Respond_Restored = New-ResponseAction -RunAfter ([ordered]@{ Restore_By_Model = @("Succeeded") }) -Body ([ordered]@{
            status = "Restored"
            settingId = "@triggerBody()?['settingId']"
            restoredValue = "@triggerBody()?['restoreValue']"
            currentValue = "@triggerBody()?['restoreValue']"
        })
    }
    else = [ordered]@{
        actions = [ordered]@{
            Respond_Restore_Blocked = New-ResponseAction -Body ([ordered]@{
                status = "Blocked"
                settingId = "@triggerBody()?['settingId']"
                restoredValue = ""
                currentValue = $storedValueExpression
            })
        }
    }
}
$flows.Restore = [ordered]@{
    Name = "PPWFA - Restore Previous Fields"
    Slug = "PPWFARestorePreviousFields"
    Definition = New-Definition (New-Trigger @("targetEnvironment", "modelKind", "settingId", "settingName", "expectedCurrentValue", "restoreValue")) $restoreActions
}

$verifyActions = [ordered]@{}
$verifyActions["Is_Standard_Model"] = [ordered]@{
    runAfter = [ordered]@{}
    type = "If"
    expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "standard") }
    actions = [ordered]@{
        Get_Standard_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "adx_sitesettings"; recordId = "@triggerBody()?['settingId']" })
    }
    else = [ordered]@{
        actions = [ordered]@{
            Is_Modern_Model = [ordered]@{
                runAfter = [ordered]@{}
                type = "If"
                expression = [ordered]@{ equals = @("@toLower(triggerBody()?['modelKind'])", "modern") }
                actions = [ordered]@{
                    Get_Modern_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "mspp_sitesettings"; recordId = "@triggerBody()?['settingId']" })
                }
                else = [ordered]@{
                    actions = [ordered]@{
                        Get_Enhanced_Setting = New-DataverseAction "GetItemWithOrganization" ([ordered]@{ organization = "@triggerBody()?['targetEnvironment']"; entityName = "powerpagecomponents"; recordId = "@triggerBody()?['settingId']" })
                    }
                }
            }
        }
    }
}
$verifyActions["Respond_to_Power_App"] = New-ResponseAction -RunAfter ([ordered]@{ Is_Standard_Model = @("Succeeded") }) -Body ([ordered]@{
    settingId = "@triggerBody()?['settingId']"
    settingName = $storedNameExpression
    currentValue = $storedValueExpression
    wildcardPresent = "@string(contains(split(replace($storedValueFunction,' ',''),','),'*'))"
})
$flows.Verify = [ordered]@{
    Name = "PPWFA - Verify Applied Fields"
    Slug = "PPWFAVerifyAppliedFields"
    Definition = New-Definition (New-Trigger @("targetEnvironment", "modelKind", "settingId")) $verifyActions
}

$workflowDirectory = Join-Path $SolutionSource "Workflows"
New-Item -ItemType Directory -Path $workflowDirectory -Force | Out-Null
Get-ChildItem $workflowDirectory -Filter "PPWFA*.json*" -ErrorAction SilentlyContinue | Remove-Item -Force
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

foreach ($key in $flows.Keys) {
    $flow = $flows[$key]
    $id = $workflowIds[$key]
    $fileName = "$($flow.Slug)-$($id.ToUpperInvariant()).json"
    $jsonPath = Join-Path $workflowDirectory $fileName
    $metadataPath = "$jsonPath.data.xml"

    [System.IO.File]::WriteAllText($jsonPath, ($flow.Definition | ConvertTo-Json -Depth 100), $utf8WithoutBom)
    [System.IO.File]::WriteAllText($metadataPath, (New-WorkflowMetadata $id $flow.Name $fileName), $utf8WithoutBom)
}

$solutionXmlPath = Join-Path $SolutionSource "Other\Solution.xml"
[xml]$solutionXml = Get-Content $solutionXmlPath -Raw
$manifest = $solutionXml.ImportExportXml.SolutionManifest
$manifest.Version = $Version
$manifest.UniqueName = "PowerPagesWebApiFieldsAuditor"
$manifest.LocalizedNames.LocalizedName.description = "Power Pages Wildcard & Anonymous Access Auditor"

$rootComponents = $manifest.RootComponents
@($rootComponents.RootComponent) | Where-Object { $_.type -eq "29" } | ForEach-Object {
    [void]$rootComponents.RemoveChild($_)
}
foreach ($id in $workflowIds.Values) {
    $component = $solutionXml.CreateElement("RootComponent")
    $component.SetAttribute("type", "29")
    $component.SetAttribute("id", "{$id}")
    $component.SetAttribute("behavior", "0")
    [void]$rootComponents.AppendChild($component)
}
$solutionXml.Save($solutionXmlPath)

$customizationsPath = Join-Path $SolutionSource "Other\Customizations.xml"
[xml]$customizations = Get-Content $customizationsPath -Raw
$root = $customizations.ImportExportXml
if ($root.connectionreferences) {
    [void]$root.RemoveChild($root.connectionreferences)
}
$connectionReferences = $customizations.CreateElement("connectionreferences")
$references = @(
    [ordered]@{ logicalName = $connectionLogicalName; displayName = "Microsoft Dataverse Power Pages Web API Fields Auditor"; connectorId = $connectorId },
    [ordered]@{ logicalName = $managementConnectionLogicalName; displayName = "Power Automate Management Power Pages Web API Fields Auditor"; connectorId = $managementConnectorId }
)
foreach ($reference in $references) {
    $connectionReference = $customizations.CreateElement("connectionreference")
    $connectionReference.SetAttribute("connectionreferencelogicalname", $reference.logicalName)
    foreach ($entry in ([ordered]@{
        connectionreferencedisplayname = $reference.displayName
        connectorid = $reference.connectorId
        iscustomizable = "1"
        promptingbehavior = "0"
        statecode = "0"
        statuscode = "1"
    }).GetEnumerator()) {
        $element = $customizations.CreateElement($entry.Key)
        $element.InnerText = $entry.Value
        [void]$connectionReference.AppendChild($element)
    }
    [void]$connectionReferences.AppendChild($connectionReference)
}
$languages = $root.Languages
[void]$root.InsertBefore($connectionReferences, $languages)
$customizations.Save($customizationsPath)

Write-Host "Generated $($flows.Count) schema-neutral workflows with tenant discovery, full code retrieval, and selected-environment Dataverse operations."
