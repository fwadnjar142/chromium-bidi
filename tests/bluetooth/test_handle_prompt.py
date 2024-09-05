#  Copyright 2024 Google LLC.
#  Copyright (c) Microsoft Corporation.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.

import pytest
from test_helpers import (AnyExtending, execute_command, goto_url,
                          send_JSON_command, subscribe, wait_for_event)

HTML_SINGLE_PERIPHERAL = """
<div>
    <a href="#" id="bluetooth" target="_blank">bluetooth</a>
    <script>
        var options = {filters: [{name:"SomeDevice"}]};
        document.getElementById('bluetooth').addEventListener('click', () => {
        navigator.bluetooth.requestDevice(options);
    });
    </script>
</div>
"""


@pytest.mark.asyncio
@pytest.mark.parametrize('capabilities', [{
    'goog:chromeOptions': {
        'args': ['--enable-features=WebBluetooth']
    }
}],
                         indirect=True)
async def test_bluetooth_handle_prompt(websocket, context_id, html,
                                       test_headless_mode):
    if test_headless_mode == "old":
        pytest.xfail("Old headless mode does not support Bluetooth")

    await subscribe(websocket, ['bluetooth'])

    url = html(HTML_SINGLE_PERIPHERAL)
    await goto_url(websocket, context_id, url)

    # Enable BT emulation.
    await execute_command(
        websocket, {
            'method': 'cdp.sendCommand',
            'params': {
                'method': 'BluetoothEmulation.enable',
                'params': {
                    'state': 'powered-on',
                }
            }
        })

    # Create a fake BT device.
    fake_device_address = '09:09:09:09:09:09'
    await execute_command(
        websocket, {
            'method': 'cdp.sendCommand',
            'params': {
                'method': 'BluetoothEmulation.simulatePreconnectedPeripheral',
                'params': {
                    'address': fake_device_address,
                    'name': 'SomeDevice',
                    'manufacturerData': [],
                    'knownServiceUuids':
                        ['12345678-1234-5678-9abc-def123456789', ],
                }
            }
        })

    await send_JSON_command(
        websocket, {
            'method': 'script.evaluate',
            'params': {
                'expression': 'document.querySelector("#bluetooth").click();',
                'awaitPromise': True,
                'target': {
                    'context': context_id,
                },
                'userActivation': True
            }
        })

    response = await wait_for_event(websocket,
                                    'bluetooth.requestDevicePromptOpened')
    assert response == AnyExtending({
        'type': 'event',
        'method': 'bluetooth.requestDevicePromptOpened',
        'params': {
            'context': context_id,
            'devices': [{
                'id': fake_device_address
            }],
        }
    })