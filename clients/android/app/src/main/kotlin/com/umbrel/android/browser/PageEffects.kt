package com.umbrel.android.browser

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.view.ViewGroup
import android.webkit.MimeTypeMap
import android.webkit.WebChromeClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.umbrel.android.ui.openUrl
import java.io.File
import java.util.UUID

/**
 * Everything a page asks of the person while it's on screen: its dialogs, camera and
 * microphone, files to upload, a website to open in a Custom Tab, a download to share, and
 * video in full screen. A page that isn't shown keeps its requests until it is.
 */
@Composable
internal fun PageEffects(page: BrowserPage, isShown: Boolean) {
	if (!isShown) return
	val context = LocalContext.current

	LaunchedEffect(page.externalUrl) {
		val url = page.externalUrl ?: return@LaunchedEffect
		page.externalUrl = null
		context.openUrl(url.toString())
	}

	LaunchedEffect(page.downloadedFile) {
		val file = page.downloadedFile ?: return@LaunchedEffect
		page.downloadedFile = null
		// A page out of sight may have been overtaken by a newer download, which replaced it.
		if (!file.exists()) return@LaunchedEffect
		val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
		val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "application/octet-stream"
		val share = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
		try {
			context.startActivity(Intent.createChooser(share, file.name))
		} catch (error: ActivityNotFoundException) {
		}
	}

	page.dialog?.let { dialog -> key(dialog) { PageDialog(page, dialog) } }
	page.fileChooser?.let { chooser -> key(chooser) { FileChooserEffect(page, chooser) } }
	page.fullScreen?.let { fullScreen ->
		Dialog(onDismissRequest = page::exitFullScreen, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
			BackHandler(onBack = page::exitFullScreen)
			AndroidView(
				factory = { fullScreen.view.also { (it.parent as? ViewGroup)?.removeView(it) } },
				modifier = Modifier.fillMaxSize(),
			)
		}
	}
}

@Composable
private fun PageDialog(page: BrowserPage, dialog: BrowserPage.Dialog) {
	// Dismissed without a choice: answer for the page so it isn't left waiting.
	val dismiss = { page.answer(dialog) { dialog.dismiss() } }
	val title = page.dialogTitle
	when (dialog) {
		is BrowserPage.Dialog.Alert -> AlertDialog(
			onDismissRequest = dismiss,
			title = { Text(title) },
			text = { Text(dialog.message) },
			confirmButton = { TextButton(onClick = { page.answer(dialog) { dialog.done() } }) { Text("OK") } },
		)
		is BrowserPage.Dialog.Confirm -> AlertDialog(
			onDismissRequest = dismiss,
			title = { Text(title) },
			text = { Text(dialog.message) },
			dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } },
			confirmButton = { TextButton(onClick = { page.answer(dialog) { dialog.done(true) } }) { Text("OK") } },
		)
		is BrowserPage.Dialog.Prompt -> {
			var text by remember { mutableStateOf(dialog.defaultText) }
			AlertDialog(
				onDismissRequest = dismiss,
				title = { Text(title) },
				text = {
					Column {
						Text(dialog.message)
						OutlinedTextField(text, { text = it }, singleLine = true)
					}
				},
				dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } },
				confirmButton = { TextButton(onClick = { page.answer(dialog) { dialog.done(text) } }) { Text("OK") } },
			)
		}
		is BrowserPage.Dialog.Credentials -> {
			var username by remember { mutableStateOf("") }
			var password by remember { mutableStateOf("") }
			AlertDialog(
				onDismissRequest = dismiss,
				title = { Text(title) },
				text = {
					Column {
						Text("${dialog.host} is asking you to sign in.")
						OutlinedTextField(username, { username = it }, label = { Text("Username") }, singleLine = true)
						OutlinedTextField(
							password,
							{ password = it },
							label = { Text("Password") },
							singleLine = true,
							visualTransformation = PasswordVisualTransformation(),
							keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
						)
					}
				},
				dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } },
				confirmButton = { TextButton(onClick = { page.answer(dialog) { dialog.done(username to password) } }) { Text("Sign In") } },
			)
		}
		is BrowserPage.Dialog.Permission -> PermissionDialog(page, dialog, title)
	}
}

/**
 * Camera and microphone: the page is named first, here, since Android's own prompt names
 * only this app and appears just once. Allowing then asks Android, if it hasn't been asked.
 */
@Composable
private fun PermissionDialog(page: BrowserPage, dialog: BrowserPage.Dialog.Permission, asker: String) {
	val context = LocalContext.current
	val permissions = dialog.resources.map {
		when (it) {
			BrowserPage.Dialog.Resource.CAMERA -> Manifest.permission.CAMERA
			BrowserPage.Dialog.Resource.MICROPHONE -> Manifest.permission.RECORD_AUDIO
		}
	}
	val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
		page.answer(dialog) { dialog.done(permissions.all { results[it] == true }) }
	}
	val what = when (dialog.resources) {
		setOf(BrowserPage.Dialog.Resource.CAMERA) -> "camera"
		setOf(BrowserPage.Dialog.Resource.MICROPHONE) -> "microphone"
		else -> "camera and microphone"
	}
	AlertDialog(
		onDismissRequest = { page.answer(dialog) { dialog.done(false) } },
		title = { Text("“$asker” Would Like to Use Your ${what.replaceFirstChar(Char::uppercase)}") },
		dismissButton = { TextButton(onClick = { page.answer(dialog) { dialog.done(false) } }) { Text("Don’t Allow") } },
		confirmButton = {
			TextButton(onClick = {
				val missing = permissions.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
				if (missing.isEmpty()) page.answer(dialog) { dialog.done(true) } else request.launch(permissions.toTypedArray())
			}) { Text("Allow") }
		},
	)
}

/**
 * A page's file input. Photos and videos open the photo picker, which needs no permission;
 * anything else opens the document picker. A camera capture asks for the camera first.
 */
@Composable
private fun FileChooserEffect(page: BrowserPage, chooser: BrowserPage.FileChooser) {
	val context = LocalContext.current
	val params = chooser.params
	val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
	val types = mimeTypes(params.acceptTypes)
	val media = types.isNotEmpty() && types.all { it.startsWith("image/") || it.startsWith("video/") }
	val captures = params.isCaptureEnabled && types.isNotEmpty() && types.all { it.startsWith("image/") }
	var captureUri by remember { mutableStateOf<Uri?>(null) }

	val pickOne = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { page.finishFileChooser(listOfNotNull(it)) }
	val pickMany = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { page.finishFileChooser(it) }
	val openOne = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { page.finishFileChooser(listOfNotNull(it)) }
	val openMany = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { page.finishFileChooser(it) }
	val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
		page.finishFileChooser(if (taken) listOfNotNull(captureUri) else null)
	}
	val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
		if (granted) captureUri?.let(takePicture::launch) else page.finishFileChooser(null)
	}

	LaunchedEffect(chooser) {
		try {
			when {
				captures -> {
					val file = File(context.cacheDir, "Captures/${UUID.randomUUID()}.jpg").apply { parentFile?.mkdirs() }
					val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
					captureUri = uri
					if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
						takePicture.launch(uri)
					} else {
						cameraPermission.launch(Manifest.permission.CAMERA)
					}
				}
				media -> {
					val kind = when {
						types.all { it.startsWith("image/") } -> ActivityResultContracts.PickVisualMedia.ImageOnly
						types.all { it.startsWith("video/") } -> ActivityResultContracts.PickVisualMedia.VideoOnly
						else -> ActivityResultContracts.PickVisualMedia.ImageAndVideo
					}
					val request = PickVisualMediaRequest(kind)
					if (multiple) pickMany.launch(request) else pickOne.launch(request)
				}
				else -> {
					val documents = types.ifEmpty { listOf("*/*") }.toTypedArray()
					if (multiple) openMany.launch(documents) else openOne.launch(documents)
				}
			}
		} catch (error: ActivityNotFoundException) {
			page.finishFileChooser(null)
		}
	}
}

/** A file input's accept list as MIME types: extensions are looked up, and "*" means anything. */
internal fun mimeTypes(accept: Array<String>): List<String> =
	accept.flatMap { it.split(',') }
		.map { it.trim().lowercase() }
		.filter { it.isNotEmpty() }
		.mapNotNull { type ->
			when {
				type == "*" || type == "*/*" -> "*/*"
				type.startsWith(".") -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.drop(1))
				"/" in type -> type
				else -> null
			}
		}
		.let { types -> if ("*/*" in types) emptyList() else types.distinct() }
