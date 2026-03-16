export type SdfCategory =
    | 'scripts'
    | 'records'
    | 'fields'
    | 'forms'
    | 'plugins'
    | 'centers'
    | 'analytics'
    | 'templates'
    | 'other';

export interface SdfObjectDef {
    type: string;
    label: string;
    prefix: string;
    rootTag: string;
    category: SdfCategory;
    description: string;
}

export const SDF_CATEGORY_META: { id: SdfCategory; label: string; command: string }[] = [
    { id: 'scripts',   label: 'Script Definition...',      command: 'suiteforge.newSdfScript' },
    { id: 'records',   label: 'Record or List...',         command: 'suiteforge.newSdfRecord' },
    { id: 'fields',    label: 'Field...',                  command: 'suiteforge.newSdfField' },
    { id: 'forms',     label: 'Form...',                   command: 'suiteforge.newSdfForm' },
    { id: 'plugins',   label: 'Plug-in...',                command: 'suiteforge.newSdfPlugin' },
    { id: 'centers',   label: 'Center & Navigation...',    command: 'suiteforge.newSdfCenter' },
    { id: 'analytics', label: 'Analytics...',              command: 'suiteforge.newSdfAnalytics' },
    { id: 'templates', label: 'Template & Translation...', command: 'suiteforge.newSdfTemplate' },
    { id: 'other',     label: 'Other...',                  command: 'suiteforge.newSdfOther' },
];

export const SDF_OBJECTS: SdfObjectDef[] = [
    // ── Scripts ──────────────────────────────────────────────────────────
    { type: 'clientscript',             label: 'Client Script',              prefix: 'customscript_',    rootTag: 'clientscript',             category: 'scripts',   description: 'Defines a client script that runs in the browser when users interact with NetSuite records.' },
    { type: 'usereventscript',          label: 'User Event Script',          prefix: 'customscript_',    rootTag: 'usereventscript',          category: 'scripts',   description: 'Defines a user event script that executes server-side on record events (beforeLoad, beforeSubmit, afterSubmit).' },
    { type: 'suitelet',                 label: 'Suitelet',                   prefix: 'customscript_',    rootTag: 'suitelet',                 category: 'scripts',   description: 'Defines a Suitelet script that creates custom pages and backend logic accessible via URL.' },
    { type: 'restlet',                  label: 'RESTlet',                    prefix: 'customscript_',    rootTag: 'restlet',                  category: 'scripts',   description: 'Defines a RESTlet script that exposes a RESTful endpoint for external integrations.' },
    { type: 'scheduledscript',          label: 'Scheduled Script',           prefix: 'customscript_',    rootTag: 'scheduledscript',          category: 'scripts',   description: 'Defines a scheduled script that runs server-side on a defined schedule or on demand.' },
    { type: 'mapreducescript',          label: 'Map/Reduce Script',          prefix: 'customscript_',    rootTag: 'mapreducescript',          category: 'scripts',   description: 'Defines a map/reduce script for processing large data sets in parallel stages.' },
    { type: 'massupdatescript',         label: 'Mass Update Script',         prefix: 'customscript_',    rootTag: 'massupdatescript',         category: 'scripts',   description: 'Defines a mass update script that performs custom updates on selected records.' },
    { type: 'portlet',                  label: 'Portlet',                    prefix: 'customscript_',    rootTag: 'portlet',                  category: 'scripts',   description: 'Defines a portlet script that renders a custom dashboard portlet.' },
    { type: 'bundleinstallationscript', label: 'Bundle Installation Script', prefix: 'customscript_',    rootTag: 'bundleinstallationscript', category: 'scripts',   description: 'Defines a bundle installation script that runs during bundle install, update, or uninstall.' },
    { type: 'sdfinstallationscript',    label: 'SDF Installation Script',    prefix: 'customscript_',    rootTag: 'sdfinstallationscript',    category: 'scripts',   description: 'Defines an SDF installation script that runs during SuiteCloud project deployment.' },
    { type: 'workflowactionscript',     label: 'Workflow Action Script',     prefix: 'customscript_',    rootTag: 'workflowactionscript',     category: 'scripts',   description: 'Defines a workflow action script triggered as a custom action in a workflow.' },
    { type: 'toolset',                  label: 'Tool Script',                prefix: 'custtoolset_',     rootTag: 'toolset',                  category: 'scripts',   description: 'Defines a custom tool script available to users in the NetSuite UI.' },

    // ── Records & Lists ──────────────────────────────────────────────────
    { type: 'customrecordtype',    label: 'Custom Record Type',        prefix: 'customrecord_',      rootTag: 'customrecordtype',        category: 'records', description: 'Defines a custom record type for storing structured data in NetSuite.' },
    { type: 'customlist',          label: 'Custom List',               prefix: 'customlist_',        rootTag: 'customlist',              category: 'records', description: 'Defines a custom list of values that can be referenced by custom fields.' },
    { type: 'customtransactiontype', label: 'Custom Transaction Type', prefix: 'customtransaction_', rootTag: 'customtransactiontype',   category: 'records', description: 'Defines a custom transaction record type.' },
    { type: 'customsegment',      label: 'Custom Segment',            prefix: 'cseg_',              rootTag: 'customsegment',           category: 'records', description: 'Defines a custom segment for classification and reporting. Must be associated with a custom record type.' },
    { type: 'sublist',            label: 'Sublist',                    prefix: 'custsublist_',       rootTag: 'sublist',                 category: 'records', description: 'Defines a custom sublist that can be added to record types.' },

    // ── Fields ───────────────────────────────────────────────────────────
    { type: 'crmcustomfield',              label: 'CRM Custom Field',                    prefix: 'curcustomfield_',  rootTag: 'crmcustomfield',              category: 'fields', description: 'Defines a custom field for CRM records (events, tasks, phone calls).' },
    { type: 'entitycustomfield',           label: 'Entity Custom Field',                 prefix: 'custentity_',      rootTag: 'entitycustomfield',           category: 'fields', description: 'Defines a custom field for entity records (customers, vendors, employees, contacts).' },
    { type: 'itemcustomfield',             label: 'Item Custom Field',                   prefix: 'custitem_',        rootTag: 'itemcustomfield',             category: 'fields', description: 'Defines a custom field for item records.' },
    { type: 'itemnumbercustomfield',       label: 'Item Number Custom Field',            prefix: 'custitemnumber_',  rootTag: 'itemnumbercustomfield',       category: 'fields', description: 'Defines a custom field for item number records.' },
    { type: 'itemoptioncustomfield',       label: 'Transaction Item Option Field',       prefix: 'custcol_',         rootTag: 'itemoptioncustomfield',       category: 'fields', description: 'Defines a custom transaction item option (column) field.' },
    { type: 'othercustomfield',            label: 'Other Record Custom Field',           prefix: 'curecord_',        rootTag: 'othercustomfield',            category: 'fields', description: 'Defines a custom field for other (non-entity, non-item, non-CRM) record types.' },
    { type: 'transactionbodycustomfield',  label: 'Transaction Body Custom Field',       prefix: 'custbody_',        rootTag: 'transactionbodycustomfield',  category: 'fields', description: 'Defines a custom field on the body (header) of transaction records.' },
    { type: 'transactioncolumncustomfield', label: 'Transaction Column Custom Field',    prefix: 'custcol_',         rootTag: 'transactioncolumncustomfield', category: 'fields', description: 'Defines a custom field on transaction line items.' },

    // ── Forms ────────────────────────────────────────────────────────────
    { type: 'addressform',     label: 'Custom Address Form',   prefix: 'custaddressform_', rootTag: 'addressForm',     category: 'forms', description: 'Defines a custom address form layout.' },
    { type: 'entryform',       label: 'Custom Entry Form',     prefix: 'custform_',        rootTag: 'entryForm',       category: 'forms', description: 'Defines a custom entry form for record types. Import existing instances from NetSuite rather than creating from scratch.' },
    { type: 'transactionform', label: 'Transaction Form',      prefix: 'custform_',        rootTag: 'transactionForm', category: 'forms', description: 'Defines a custom transaction form layout. Import existing instances from NetSuite rather than creating from scratch.' },

    // ── Plug-ins ─────────────────────────────────────────────────────────
    { type: 'plugintype',              label: 'Custom Plug-in Type',                   prefix: 'customscript_', rootTag: 'plugintype',              category: 'plugins', description: 'Defines a custom plug-in type that other scripts can implement.' },
    { type: 'pluginimplementation',    label: 'Custom Plug-in Implementation',         prefix: 'customscript_', rootTag: 'pluginimplementation',    category: 'plugins', description: 'Defines a custom plug-in implementation for a given plug-in type.' },
    { type: 'customglplugin',          label: 'Custom GL Lines Plug-in',               prefix: 'customscript_', rootTag: 'customglplugin',          category: 'plugins', description: 'Defines a Custom GL Lines plug-in for creating custom GL impact lines.' },
    { type: 'bankstatementparserplugin', label: 'Bank Statement Parser Plug-in',       prefix: 'customscript_', rootTag: 'bankstatementparserplugin', category: 'plugins', description: 'Defines a Bank Statement Parser plug-in for importing bank statement files.' },
    { type: 'emailcaptureplugin',      label: 'Email Capture Plug-in',                 prefix: 'customscript_', rootTag: 'emailcaptureplugin',      category: 'plugins', description: 'Defines an Email Capture plug-in for processing inbound emails.' },
    { type: 'ficonnectivityplugin',    label: 'FI Connectivity Plug-in',               prefix: 'customscript_', rootTag: 'ficonnectivityplugin',    category: 'plugins', description: 'Defines a Financial Institution Connectivity plug-in.' },
    { type: 'fiparserplugin',          label: 'FI Parser Plug-in',                     prefix: 'customscript_', rootTag: 'fiparserplugin',          category: 'plugins', description: 'Defines a Financial Institution Parser plug-in.' },
    { type: 'datasetbuilderplugin',    label: 'Dataset Builder Plug-in',               prefix: 'customscript_', rootTag: 'datasetbuilderplugin',    category: 'plugins', description: 'Defines a Dataset Builder plug-in for creating custom datasets.' },
    { type: 'workbookbuilderplugin',   label: 'Workbook Builder Plug-in',              prefix: 'customscript_', rootTag: 'workbookbuilderplugin',   category: 'plugins', description: 'Defines a Workbook Builder plug-in for creating custom workbooks.' },

    // ── Centers & Navigation ─────────────────────────────────────────────
    { type: 'center',         label: 'Center',          prefix: 'custcenter_',         rootTag: 'center',         category: 'centers', description: 'Defines a custom center in the NetSuite navigation.' },
    { type: 'centercategory', label: 'Center Category', prefix: 'custcentercategory_', rootTag: 'centercategory', category: 'centers', description: 'Defines a category within a center.' },
    { type: 'centerlink',     label: 'Center Link',     prefix: 'custlink_',           rootTag: 'centerlink',     category: 'centers', description: 'Defines a link within a center category.' },
    { type: 'centertab',      label: 'Center Tab',      prefix: 'custcentertab_',      rootTag: 'centertab',      category: 'centers', description: 'Defines a tab within a center.' },
    { type: 'subtab',         label: 'Subtab',          prefix: 'custtab_',            rootTag: 'subtab',         category: 'centers', description: 'Defines a custom subtab on a record form.' },

    // ── Analytics ────────────────────────────────────────────────────────
    { type: 'dataset',             label: 'Dataset',              prefix: 'custdataset_',      rootTag: 'dataset',             category: 'analytics', description: 'Defines a SuiteAnalytics dataset. Do not manually modify — use NetSuite to edit and re-import.' },
    { type: 'workbook',            label: 'Workbook',             prefix: 'custworkbook_',     rootTag: 'workbook',            category: 'analytics', description: 'Defines a SuiteAnalytics workbook. Do not manually modify — use NetSuite to edit and re-import.' },
    { type: 'kpiscorecard',        label: 'KPI Scorecard',        prefix: 'custkpiscorecard_', rootTag: 'kpiscorecard',        category: 'analytics', description: 'Defines a custom KPI scorecard.' },
    { type: 'reportdefinition',    label: 'Report Definition',    prefix: 'customreport_',     rootTag: 'reportdefinition',    category: 'analytics', description: 'Defines a custom financial report definition.' },
    { type: 'financiallayout',     label: 'Financial Layout',     prefix: 'customlayout_',     rootTag: 'financiallayout',     category: 'analytics', description: 'Defines a custom financial report layout.' },
    { type: 'savedsearch',         label: 'Saved Search',         prefix: 'customsearch_',     rootTag: 'savedsearch',         category: 'analytics', description: 'Defines a saved search. Do not manually edit — use NetSuite to create and re-import.' },
    { type: 'publisheddashboard',  label: 'Published Dashboard',  prefix: 'custpubdashboard_', rootTag: 'publisheddashboard',  category: 'analytics', description: 'Defines a published dashboard layout.' },

    // ── Templates & Translations ─────────────────────────────────────────
    { type: 'advancedpdftemplate',  label: 'Advanced PDF Template',  prefix: 'custtmpl_',       rootTag: 'advancedpdftemplate',  category: 'templates', description: 'Defines an Advanced HTML/PDF template. Ensure it is associated with a .template.xml file in the Templates folder.' },
    { type: 'emailtemplate',        label: 'Email Template',         prefix: 'custemailtmpl_',  rootTag: 'emailtemplate',        category: 'templates', description: 'Defines a custom email template.' },
    { type: 'translationcollection', label: 'Translation Collection', prefix: 'custcollection_', rootTag: 'translationcollection', category: 'templates', description: 'Defines a collection of translatable strings.' },

    // ── Other ────────────────────────────────────────────────────────────
    { type: 'workflow',        label: 'Workflow',              prefix: 'customworkflow_',  rootTag: 'workflow',        category: 'other', description: 'Defines a workflow with states, transitions, and actions.' },
    { type: 'integration',     label: 'Integration',           prefix: 'custinteg_',       rootTag: 'integration',     category: 'other', description: 'Defines an integration record for token-based authentication (TBA) and OAuth.' },
    { type: 'role',            label: 'Custom Role',           prefix: 'customrole_',      rootTag: 'role',            category: 'other', description: 'Defines a custom role with specific permissions.' },
    { type: 'savedcsvimport',  label: 'Saved CSV Import',      prefix: 'custimport_',      rootTag: 'savedcsvimport',  category: 'other', description: 'Defines a saved CSV import map.' },
    { type: 'secret',          label: 'Secret',                prefix: 'custsecret_',      rootTag: 'secret',          category: 'other', description: 'Defines a secret value for use in SuiteScript.' },
    { type: 'cmscontenttype',  label: 'CMS Content Type',      prefix: 'custcontenttype_', rootTag: 'cmscontenttype',  category: 'other', description: 'Defines a CMS content type for SuiteCommerce.' },
    { type: 'sspapplication',  label: 'SSP Application',       prefix: 'webapp_',          rootTag: 'sspapplication',  category: 'other', description: 'Defines a server-side pages (SSP) web application.' },
    { type: 'singlepageapp',   label: 'Single Page App',       prefix: 'custspa_',         rootTag: 'singlepageapp',   category: 'other', description: 'Defines a single page application hosted in NetSuite.' },
];
