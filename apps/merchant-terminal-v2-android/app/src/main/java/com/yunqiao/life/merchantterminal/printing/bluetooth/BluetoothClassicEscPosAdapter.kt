package com.yunqiao.life.merchantterminal.printing.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterAdapter
import com.yunqiao.life.merchantterminal.printing.PrinterCandidate
import com.yunqiao.life.merchantterminal.printing.PrinterChannel
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.lan.NetworkWriteOutcome
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

enum class BluetoothDiscoveryState {
    READY,
    DISABLED,
    UNAVAILABLE,
    PERMISSION_DENIED,
    EMPTY,
}

data class BluetoothDiscoveryResult(
    val state: BluetoothDiscoveryState,
    val devices: List<PrinterCandidate> = emptyList(),
)

object BluetoothDiscoveryStateResolver {
    fun resolve(
        adapterAvailable: Boolean,
        permissionReady: Boolean,
        adapterEnabled: Boolean,
        hasCandidates: Boolean,
        discoveryFinished: Boolean,
    ): BluetoothDiscoveryState = when {
        !adapterAvailable -> BluetoothDiscoveryState.UNAVAILABLE
        !permissionReady -> BluetoothDiscoveryState.PERMISSION_DENIED
        !adapterEnabled -> BluetoothDiscoveryState.DISABLED
        hasCandidates || !discoveryFinished -> BluetoothDiscoveryState.READY
        else -> BluetoothDiscoveryState.EMPTY
    }
}

data class BluetoothPermissionState(
    val canScan: Boolean,
    val canConnect: Boolean,
) {
    val ready: Boolean
        get() = canScan && canConnect
}

class BluetoothPermissionPolicy(private val context: Context) {
    fun current(): BluetoothPermissionState =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            BluetoothPermissionState(
                canScan = context.hasPermission(Manifest.permission.BLUETOOTH_SCAN),
                canConnect = context.hasPermission(Manifest.permission.BLUETOOTH_CONNECT),
            )
        } else {
            BluetoothPermissionState(
                canScan = context.hasPermission(Manifest.permission.ACCESS_FINE_LOCATION),
                canConnect = true,
            )
        }

    fun runtimePermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
            )
        } else {
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }

    private fun Context.hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}

interface BluetoothConnection : AutoCloseable {
    fun writeOnce(bytes: ByteArray): NetworkWriteOutcome
}

fun interface BluetoothConnectionFactory {
    fun connect(config: PrinterConnectionConfig.Bluetooth): BluetoothConnection
}

class AndroidBluetoothConnectionFactory(
    context: Context,
) : BluetoothConnectionFactory {
    private val applicationContext = context.applicationContext
    private val adapter = applicationContext
        .getSystemService(BluetoothManager::class.java)
        ?.adapter
    private val permissions = BluetoothPermissionPolicy(applicationContext)

    @SuppressLint("MissingPermission")
    override fun connect(config: PrinterConnectionConfig.Bluetooth): BluetoothConnection {
        if (!permissions.current().canConnect) {
            throw SecurityException("BLUETOOTH_CONNECT permission is required.")
        }
        val activeAdapter = adapter ?: error("Bluetooth is unavailable.")
        check(activeAdapter.isEnabled) { "Bluetooth is disabled." }
        val device = activeAdapter.getRemoteDevice(config.macAddress)
        check(device.bondState == BluetoothDevice.BOND_BONDED) {
            "Bluetooth device must be paired by Android before connection."
        }
        activeAdapter.cancelDiscovery()
        val socket = device.createRfcommSocketToServiceRecord(UUID.fromString(config.serviceUuid))
        val executor = Executors.newSingleThreadExecutor()
        return try {
            val future = executor.submit { socket.connect() }
            try {
                future.get(config.connectTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
            } catch (timeout: TimeoutException) {
                runCatching { socket.close() }
                future.cancel(true)
                throw java.net.SocketTimeoutException("Bluetooth RFCOMM connect timeout")
            }
            AndroidBluetoothConnection(socket)
        } catch (error: Throwable) {
            runCatching { socket.close() }
            throw error
        } finally {
            executor.shutdownNow()
        }
    }
}

private class AndroidBluetoothConnection(
    private val socket: BluetoothSocket,
) : BluetoothConnection {
    override fun writeOnce(bytes: ByteArray): NetworkWriteOutcome {
        var written = 0
        var attempted = false
        return try {
            val output = socket.outputStream
            while (written < bytes.size) {
                val count = minOf(BLUETOOTH_WRITE_CHUNK, bytes.size - written)
                attempted = true
                output.write(bytes, written, count)
                written += count
            }
            output.flush()
            NetworkWriteOutcome.Complete(written)
        } catch (error: Throwable) {
            NetworkWriteOutcome.Failed(
                writtenBytes = written,
                ioAttempted = attempted,
                timedOut = false,
                detail = error.javaClass.simpleName.take(80),
            )
        }
    }

    override fun close() {
        socket.close()
    }

    private companion object {
        const val BLUETOOTH_WRITE_CHUNK = 1_024
    }
}

class BluetoothClassicEscPosAdapter(
    context: Context,
    private val discovery: BluetoothClassicDiscovery = BluetoothClassicDiscovery(context),
    private val connectionFactory: BluetoothConnectionFactory =
        AndroidBluetoothConnectionFactory(context),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : PrinterAdapter {
    private val mutex = Mutex()
    private var connection: BluetoothConnection? = null

    override suspend fun discover(): List<PrinterCandidate> = discovery.pairedDevices().devices

    override suspend fun connect(config: PrinterConnectionConfig): Result<Unit> =
        withContext(ioDispatcher) {
            runCatching {
                val bluetooth = config as? PrinterConnectionConfig.Bluetooth
                    ?: error("Bluetooth adapter received a non-Bluetooth config.")
                mutex.withLock {
                    connection?.close()
                    connection = connectionFactory.connect(bluetooth)
                }
            }
        }

    override suspend fun print(document: PrintableDocument): PrintResult =
        withContext(ioDispatcher) {
            mutex.withLock {
                val active = connection ?: return@withLock PrintResult.Failure(
                    code = UsbPrintErrorCode.BLUETOOTH_CONNECT_FAILED,
                    technicalDetail = "Bluetooth connection is not open.",
                    plannedBytes = document.bytes.size,
                )
                when (val outcome = active.writeOnce(document.bytes)) {
                    is NetworkWriteOutcome.Complete -> PrintResult.Success(
                        plannedBytes = document.bytes.size,
                        writtenBytes = outcome.writtenBytes,
                    )
                    is NetworkWriteOutcome.Failed -> PrintResult.Failure(
                        code = UsbPrintErrorCode.BLUETOOTH_WRITE_FAILED,
                        technicalDetail = outcome.detail,
                        plannedBytes = document.bytes.size,
                        writtenBytes = outcome.writtenBytes,
                        ioAttempted = outcome.ioAttempted,
                    )
                }
            }
        }

    override suspend fun disconnect() {
        withContext(ioDispatcher) {
            mutex.withLock {
                runCatching { connection?.close() }
                connection = null
            }
        }
    }
}

class BluetoothClassicDiscovery(context: Context) {
    private val applicationContext = context.applicationContext
    private val bluetoothAdapter: BluetoothAdapter? = applicationContext
        .getSystemService(BluetoothManager::class.java)
        ?.adapter
    private val permissions = BluetoothPermissionPolicy(applicationContext)

    @SuppressLint("MissingPermission")
    fun pairedDevices(): BluetoothDiscoveryResult {
        val availability = currentState(discoveryFinished = true)
        if (availability !in setOf(BluetoothDiscoveryState.READY, BluetoothDiscoveryState.EMPTY)) {
            return BluetoothDiscoveryResult(availability)
        }
        val devices = bluetoothAdapter?.bondedDevices.orEmpty()
            .map(::candidate)
            .sortedBy(PrinterCandidate::displayName)
        return BluetoothDiscoveryResult(
            state = if (devices.isEmpty()) {
                BluetoothDiscoveryState.EMPTY
            } else {
                BluetoothDiscoveryState.READY
            },
            devices = devices,
        )
    }

    @SuppressLint("MissingPermission")
    fun requestSystemPairing(macAddress: String): Boolean {
        if (!permissions.current().canConnect) return false
        val adapter = bluetoothAdapter ?: return false
        val device = runCatching { adapter.getRemoteDevice(macAddress) }.getOrNull() ?: return false
        if (device.bondState == BluetoothDevice.BOND_BONDED) return true
        return runCatching { device.createBond() }.getOrDefault(false)
    }

    @SuppressLint("MissingPermission")
    fun nearbyDevices(): Flow<BluetoothDiscoveryResult> = callbackFlow {
        val initialState = currentState(discoveryFinished = false)
        if (initialState != BluetoothDiscoveryState.READY) {
            trySend(BluetoothDiscoveryResult(initialState))
            close()
            return@callbackFlow
        }
        val activeAdapter = checkNotNull(bluetoothAdapter)
        val discovered = linkedMapOf<String, PrinterCandidate>()
        pairedDevices().devices.forEach { discovered[it.identifier] = it }
        trySend(BluetoothDiscoveryResult(BluetoothDiscoveryState.READY, discovered.values.toList()))

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == BluetoothDevice.ACTION_FOUND) {
                    intent.bluetoothDevice()?.let { device ->
                        runCatching { candidate(device) }.getOrNull()?.let {
                            discovered[it.identifier] = it
                            trySend(
                                BluetoothDiscoveryResult(
                                    BluetoothDiscoveryState.READY,
                                    discovered.values.sortedBy(PrinterCandidate::displayName),
                                ),
                            )
                        }
                    }
                }
                if (intent.action == BluetoothAdapter.ACTION_DISCOVERY_FINISHED) {
                    trySend(
                        BluetoothDiscoveryResult(
                            state = if (discovered.isEmpty()) {
                                BluetoothDiscoveryState.EMPTY
                            } else {
                                BluetoothDiscoveryState.READY
                            },
                            devices = discovered.values.sortedBy(PrinterCandidate::displayName),
                        ),
                    )
                    close()
                }
            }
        }
        ContextCompat.registerReceiver(
            applicationContext,
            receiver,
            IntentFilter().apply {
                addAction(BluetoothDevice.ACTION_FOUND)
                addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
            },
            ContextCompat.RECEIVER_EXPORTED,
        )
        if (activeAdapter.startDiscovery() != true) {
            trySend(BluetoothDiscoveryResult(BluetoothDiscoveryState.EMPTY))
            close()
        }
        awaitClose {
            runCatching { activeAdapter.cancelDiscovery() }
            runCatching { applicationContext.unregisterReceiver(receiver) }
        }
    }.distinctUntilChanged()

    @SuppressLint("MissingPermission")
    fun currentState(discoveryFinished: Boolean = false): BluetoothDiscoveryState =
        BluetoothDiscoveryStateResolver.resolve(
            adapterAvailable = bluetoothAdapter != null,
            permissionReady = permissions.current().ready,
            adapterEnabled = runCatching { bluetoothAdapter?.isEnabled == true }.getOrDefault(false),
            hasCandidates = false,
            discoveryFinished = discoveryFinished,
        )

    @SuppressLint("MissingPermission")
    private fun candidate(device: BluetoothDevice): PrinterCandidate = PrinterCandidate(
        identifier = device.address.uppercase(),
        displayName = device.name?.takeIf(String::isNotBlank)?.take(160) ?: device.address,
        channel = PrinterChannel.LOCAL_BLUETOOTH_ESCPOS,
        likelyPrinter = device.bondState == BluetoothDevice.BOND_BONDED,
        connectionOptions = emptyList(),
        bonded = device.bondState == BluetoothDevice.BOND_BONDED,
    )

    @Suppress("DEPRECATION")
    private fun Intent.bluetoothDevice(): BluetoothDevice? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
}
