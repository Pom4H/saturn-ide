"""Real PTY + Modbus RTU wire fixture. No serial hardware is claimed by this test."""
import os, pty, select, struct, sys, tty
master, slave = pty.openpty()
tty.setraw(slave)
print(os.ttyname(slave), flush=True)
registers = {0: 1234, 1: 1500}
pending = b''
def crc(data):
    value = 0xffff
    for byte in data:
        value ^= byte
        for _ in range(8):
            value = (value >> 1) ^ (0xa001 if value & 1 else 0)
    return struct.pack('<H', value)
while True:
    ready, _, _ = select.select([master, sys.stdin], [], [])
    if sys.stdin in ready:
        if not os.read(sys.stdin.fileno(), 1024):
            break
    if master not in ready:
        continue
    pending += os.read(master, 4096)
    while len(pending) >= 8:
        frame, pending = pending[:8], pending[8:]
        if crc(frame[:-2]) != frame[-2:]:
            continue
        unit, function, offset, count = struct.unpack('>BBHH', frame[:-2])
        if function == 3 and 0 < count <= 125:
            response = bytes([unit, function, count * 2]) + b''.join(struct.pack('>H', registers.get(offset + i, 0)) for i in range(count))
        elif function == 6:
            registers[offset] = count
            response = frame[:-2]
        else:
            response = bytes([unit, function | 0x80, 1])
        os.write(master, response + crc(response))
os.close(master)
os.close(slave)
