# Using the 'other' device

Sometimes a device category is not supported yet.
In these cases you can pair that device using the 'other' driver.

## Controlling the device

When you open the device in Homey, it will show a message that you cannot control it.
This is shown because the 'other' driver does not have any capabilities,
since we cannot know for certain how the data of your device should be interpreted.

It is, however, still possible to control your device through flows!
You can use the trigger flow cards to perform actions or notify you when the status of the device changes.
Using the information from these cards,
as well as the [Tuya documentation for your device](https://developer.tuya.com/en/docs/iot/standarddescription?id=K9i5ql6waswzq) (some of which can be found in the settings of the device),
you can create action cards that change the state of the device as well.

These cards are also available in other drivers,
so if your device has additional functionality, or does not neatly fit into a category,
you can use the same method to still make use of its functions.

## Using alongside another driver

If you have set up a device using the 'other' driver and support for your device is released you do not have to recreate all your flows.
Simply keep the device paired as 'other', and also pair it using the new driver.
The 'other' driver will keep functioning as before, and now you can also control the device using Homey capabilities!
