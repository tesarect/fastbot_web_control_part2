# Fastbot Web based Control
This repository is the second part of the Fastbot web Control repository, 
responsible to create frontend web page that shows the camera feed and rviz vizualization view 
along with the control interfaces.

## Screenshot
### Landing page (rosbridge connection):
<p align="center">
  <img src="images/rosbridge_connection.png">
</p>

### Navigation Page:
<p align="center">
  <img src="images/navigation_page.png">
</p>

## How to Start

Initiate the launch file first fromt the part1 repository
```bash
ros2 launch fastbot_slam navigation.launch.py
```

Then start the necessary web server, rosbridge, video streaming & tf republisher, each on a separate terminal.

1. start the http-server
```bash
cd ~/webpage_ws/fastbot_webapp
python3 -m http.server 7000
```
2. start rosbridge
```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```
3. start video server
```bash
ros2 run web_video_server web_video_server --ros-args -p port:=11315
```
4. start tf web republisher
```bash
ros2 run tf2_web_republisher_py tf2_web_republisher
```

5. to obtaing the webpage address
```bash
webpage_address
rosbridge_address
```
> ℹ️ Note
>
> You can paste the same webpage address under the rosbridge address placeholder. It will convert url to rosbridge address automatically
