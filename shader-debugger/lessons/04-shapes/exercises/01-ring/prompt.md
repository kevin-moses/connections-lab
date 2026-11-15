## A ring

`d` is the distance from the center. The starter fills everything closer than 0.3, like lesson 3.

To draw just the **outline**, you need the distance to the circle's *edge*, not its center. A pixel on the edge has `d = 0.3`, one just inside has `d = 0.28`, one just outside `d = 0.32`. So `abs(d - 0.3)` is how far a pixel is from the edge, on either side.

Draw a white **ring** of radius 0.3: white where that edge distance is below 0.01, fading to black by 0.02.
