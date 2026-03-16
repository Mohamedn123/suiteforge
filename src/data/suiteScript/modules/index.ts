import type { SsModuleDefinition } from '../types';

import nAction from './N_action.json';
import nRecord from './N_record.json';
import nSearch from './N_search.json';
import nLog from './N_log.json';
import nRuntime from './N_runtime.json';
import nEmail from './N_email.json';
import nFile from './N_file.json';
import nUrl from './N_url.json';
import nHttp from './N_http.json';
import nHttps from './N_https.json';
import nTask from './N_task.json';
import nQuery from './N_query.json';
import nRedirect from './N_redirect.json';
import nFormat from './N_format.json';
import nError from './N_error.json';
import nRender from './N_render.json';
import nEncode from './N_encode.json';
import nCrypto from './N_crypto.json';
import nCache from './N_cache.json';
import nConfig from './N_config.json';
import nCurrency from './N_currency.json';
import nXml from './N_xml.json';
import nCurrentRecord from './N_currentRecord.json';
import nUiServerWidget from './N_ui_serverWidget.json';
import nUiDialog from './N_ui_dialog.json';
import nUiMessage from './N_ui_message.json';
import nUtil from './N_util.json';
import nTransaction from './N_transaction.json';
import nWorkflow from './N_workflow.json';
import nSftp from './N_sftp.json';
import nPlugin from './N_plugin.json';
import nTranslation from './N_translation.json';
import nAuth from './N_auth.json';
import nCompress from './N_compress.json';
import nFormatI18n from './N_format_i18n.json';
import nRecordContext from './N_recordContext.json';
import nSuiteAppInfo from './N_suiteAppInfo.json';
import nKeyControl from './N_keyControl.json';
import nPiremoval from './N_piremoval.json';
import nCertificateControl from './N_certificateControl.json';
import nCryptoCertificate from './N_crypto_certificate.json';
import nCryptoRandom from './N_crypto_random.json';
import nHttpsClientCertificate from './N_https_clientCertificate.json';
import nDataset from './N_dataset.json';
import nWorkbook from './N_workbook.json';
import nLlm from './N_llm.json';
import nMachineTranslation from './N_machineTranslation.json';
import nPgp from './N_pgp.json';
import nDocumentCapture from './N_documentCapture.json';
import nPortlet from './N_portlet.json';
import nScriptTypesRestlet from './N_scriptTypes_restlet.json';
import nTaskAccountingRecognition from './N_task_accounting_recognition.json';

const modules: SsModuleDefinition[] = [
    nAction,
    nRecord,
    nSearch,
    nLog,
    nRuntime,
    nEmail,
    nFile,
    nUrl,
    nHttp,
    nHttps,
    nTask,
    nQuery,
    nRedirect,
    nFormat,
    nError,
    nRender,
    nEncode,
    nCrypto,
    nCache,
    nConfig,
    nCurrency,
    nXml,
    nCurrentRecord,
    nUiServerWidget,
    nUiDialog,
    nUiMessage,
    nUtil,
    nTransaction,
    nWorkflow,
    nSftp,
    nPlugin,
    nTranslation,
    nAuth,
    nCompress,
    nFormatI18n,
    nRecordContext,
    nSuiteAppInfo,
    nKeyControl,
    nPiremoval,
    nCertificateControl,
    nCryptoCertificate,
    nCryptoRandom,
    nHttpsClientCertificate,
    nDataset,
    nWorkbook,
    nLlm,
    nMachineTranslation,
    nPgp,
    nDocumentCapture,
    nPortlet,
    nScriptTypesRestlet,
    nTaskAccountingRecognition,
] as SsModuleDefinition[];

export default modules;
